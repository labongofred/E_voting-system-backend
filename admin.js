// ... existing imports ...
const express = require('express');
const router = express.Router();
// Import the new service
const { generateCsv, auditFields, resultsFields, turnoutFields } = require('../services/exportService'); 
const { auditLog } = require('../services/auditService');

// ... existing routes ...

// -----------------------------------------------------------------------------------

// NEW ENDPOINT: GET /api/admin/exports/:type 
router.get('/exports/:type', async (req, res) => {
    const dbClient = req.app.locals.dbClient;
    const { type } = req.params;
    let data = [];
    let fields = [];
    let filename;
    
    const adminId = 'ADMIN-001'; 

    try {
        switch (type.toLowerCase()) {
            case 'audit':
                // 1. Audit Log Export (BE-M4 Deliverable)
                filename = 'audit_log.csv';
                fields = auditFields;
                const auditResult = await dbClient.query('SELECT * FROM AuditLog ORDER BY created_at DESC');
                data = auditResult.rows;
                break;

            case 'results':
                // 2. Results Tally Export (BE-M4 Deliverable)
                filename = 'election_results.csv';
                fields = resultsFields;
                // Reuses the complex tally logic from BE-M4-01
                const tallyQuery = `
                    WITH RankedVotes AS (
                        SELECT
                            p.id AS position_id, p.name AS position_name, p.seats,
                            c.id AS candidate_id, c.name AS candidate_name,
                            COUNT(v.id) AS vote_count,
                            ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY COUNT(v.id) DESC) as rank
                        FROM positions p
                        JOIN candidates c ON p.id = c.position_id
                        LEFT JOIN votes v ON c.id = v.candidate_id
                        WHERE c.status = 'APPROVED'
                        GROUP BY p.id, p.name, p.seats, c.id, c.name
                    )
                    SELECT
                        position_id, position_name, candidate_id, candidate_name, 
                        vote_count::integer, rank,
                        CASE WHEN rank <= seats THEN 'WINNER' ELSE 'LOSER' END AS result_status
                    FROM RankedVotes
                    ORDER BY position_id, vote_count DESC;
                `;
                const resultsResult = await dbClient.query(tallyQuery);
                data = resultsResult.rows;
                break;
                
            case 'turnout':
                // 3. Turnout/Voter Status Export (BE-M4 Deliverable)
                filename = 'voter_turnout.csv';
                fields = turnoutFields;
                const turnoutQuery = `
                    SELECT 
                        ev.reg_no, ev.name, ev.program, ev.email, ev.status,
                        v.consumed_at,
                        CASE WHEN v.consumed_at IS NOT NULL THEN 'Voted' ELSE 'Not Voted' END AS has_voted
                    FROM 
                        EligibleVoters ev
                    LEFT JOIN 
                        Verifications v ON ev.id = v.voter_id AND v.consumed_at IS NOT NULL
                    ORDER BY 
                        ev.name;
                `;
                const turnoutResult = await dbClient.query(turnoutQuery);
                data = turnoutResult.rows.map(row => ({
                    ...row,
                    consumed_at: row.consumed_at ? new Date(row.consumed_at).toLocaleString() : ''
                }));
                break;

            default:
                return res.status(400).json({ error: 'Invalid export type specified. Must be audit, results, or turnout.' });
        }
        
        if (data.length === 0) {
            return res.status(404).json({ error: `No data found for ${type} export.` });
        }

        // Generate CSV string
        const csvString = generateCsv(data, fields);
        
        // Audit log the export action
        await auditLog(
            dbClient,
            'ADMIN',
            adminId,
            `${type.toUpperCase()}_EXPORTED`,
            'EXPORT',
            null,
            { file: filename, records_exported: data.length }
        );

        // Send the CSV file with appropriate headers
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(csvString);

    } catch (err) {
        console.error(`Export Error for ${type}:`, err.message);
        res.status(500).json({ error: `Failed to generate ${type} export: ${err.message}` });
    }
});

module.exports = router;