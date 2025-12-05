const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken'); // <--- ADD THIS
const rateLimit = require('express-rate-limit');
const { auditLog } = require('../services/auditService');

// --- Configuration ---
// Make sure to define a secret key in your .env file
const JWT_SECRET = process.env.JWT_SECRET || 'your_default_jwt_secret'; 
const OTP_EXPIRY_MINUTES = 5; 
const BALLOT_TOKEN_EXPIRY_HOURS = 2; // Token should last for the duration of a session

// ... existing otpRequestLimiter middleware ...

// Helper function to generate a random numeric OTP (keep this from previous step)
// function generateOTP(length) { ... } 

// -----------------------------------------------------------------------------------
// POST /api/verify/request-otp (existing from previous step)
// ...

// -----------------------------------------------------------------------------------

// NEW ENDPOINT: POST /api/verify/confirm (BE-M3-03)
router.post('/confirm', async (req, res) => {
    const dbClient = req.app.locals.dbClient;
    const { verification_id, otp } = req.body;

    // 1. Input Validation
    if (!verification_id || !otp) {
        return res.status(400).json({ error: 'Verification ID and OTP code are required.' });
    }

    let verification;

    try {
        // 2. Fetch Verification Record
        const queryText = `
            SELECT 
                v.id, v.voter_id, v.otp_hash, v.issued_at, v.verified_at, v.ballot_token,
                ev.reg_no, ev.status AS voter_status, ev.name AS voter_name
            FROM 
                Verifications v
            JOIN 
                EligibleVoters ev ON v.voter_id = ev.id
            WHERE 
                v.id = $1;
        `;
        const result = await dbClient.query(queryText, [verification_id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Verification record not found.' });
        }
        
        verification = result.rows[0];

        // 3. Check Status and Expiry
        if (verification.verified_at) {
            return res.status(403).json({ error: 'This OTP has already been used for verification.' });
        }

        const issuedTime = new Date(verification.issued_at).getTime();
        const currentTime = Date.now();
        const expiryTime = issuedTime + (OTP_EXPIRY_MINUTES * 60 * 1000);

        if (currentTime > expiryTime) {
            await auditLog(dbClient, 'VOTER', verification.voter_id, 'OTP_CONFIRM_EXPIRED', 'Verifications', verification.id);
            return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
        }
        
        if (verification.voter_status === 'BLOCKED') {
             await auditLog(dbClient, 'VOTER', verification.voter_id, 'OTP_CONFIRM_BLOCKED', 'EligibleVoters', verification.voter_id);
            return res.status(403).json({ error: 'Voter is currently BLOCKED. Verification failed.' });
        }

        // 4. Verify OTP Hash (Security Check)
        const isMatch = await bcrypt.compare(otp, verification.otp_hash);

        if (!isMatch) {
            await auditLog(dbClient, 'VOTER', verification.voter_id, 'OTP_CONFIRM_FAILED', 'Verifications', verification.id);
            // NOTE: Do not specify if it's the OTP or ID that failed for security reasons
            return res.status(401).json({ error: 'Invalid verification code or ID.' });
        }

        // 5. Generate Single-Use Ballot Token (JWT)
        // Payload must NOT contain PII (Secret Ballot requirement)
        const ballotToken = jwt.sign(
            { 
                // Only include immutable, non-PII identifiers
                verification_id: verification.id,
                voter_hash: await bcrypt.hash(verification.reg_no, 10), // Hash the reg_no to track voter without storing PII
                // The token is single-use because we check 'consumed_at' on the backend.
            },
            JWT_SECRET,
            { expiresIn: `${BALLOT_TOKEN_EXPIRY_HOURS}h` }
        );

        // 6. Update Verification Record
        const updateQuery = `
            UPDATE Verifications
            SET 
                verified_at = CURRENT_TIMESTAMP,
                ballot_token = $1
            WHERE 
                id = $2
            RETURNING id;
        `;
        await dbClient.query(updateQuery, [ballotToken, verification.id]);

        // 7. Audit Log (Auditability Requirement [cite: 67])
        await auditLog(
            dbClient, 
            'VOTER', 
            verification.voter_id, 
            'BALLOT_TOKEN_ISSUED', 
            'Verifications', 
            verification.id,
            { voter_name: verification.voter_name } // Include name for audit log clarity
        );

        // 8. Response
        res.status(200).json({
            message: 'Verification successful. Single-use ballot access token issued.',
            ballot_token: ballotToken,
            voter_id: verification.voter_id
        });

    } catch (err) {
        console.error('OTP Confirmation Error:', err.message);
        res.status(500).json({ error: 'Failed to confirm OTP.' });
    }
});

module.exports = router;