const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'your_default_jwt_secret'; // Use the secret key

// Middleware to authenticate and authorize the single-use ballot token
const ballotAuth = (req, res, next) => {
    const dbClient = req.app.locals.dbClient;

    // 1. Check for Token in Header
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Access denied. No ballot token provided.' });
    }

    const ballotToken = authHeader.split(' ')[1];

    try {
        // 2. Verify Token Signature
        const decoded = jwt.verify(ballotToken, JWT_SECRET);
        req.user = decoded; // Attach decoded token payload to request

        // 3. Check Token Status in Database (Single-Use Validation)
        const checkQuery = `
            SELECT consumed_at
            FROM Verifications
            WHERE id = $1 AND ballot_token = $2;
        `;
        // We use both ID and the token itself for security
        dbClient.query(checkQuery, [decoded.verification_id, ballotToken])
            .then(result => {
                if (result.rows.length === 0) {
                    return res.status(403).json({ error: 'Invalid or revoked ballot token.' });
                }
                
                const verification = result.rows[0];

                if (verification.consumed_at !== null) {
                    // Token has been used to vote (consumed)
                    return res.status(403).json({ error: 'Ballot has already been cast using this token.' });
                }

                // Token is valid and unused: proceed
                next();
            })
            .catch(dbError => {
                console.error("Ballot DB Check Error:", dbError.message);
                return res.status(500).json({ error: 'Internal server error during ballot validation.' });
            });

    } catch (err) {
        // 4. Handle Invalid/Expired Token
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Ballot token has expired. Please re-verify to get a new token.' });
        }
        return res.status(401).json({ error: 'Invalid ballot token.' });
    }
};

module.exports = ballotAuth;