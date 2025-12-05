const express = require('express');
const router = express.Router();
// ... imports: ballotAuth, auditLog, etc.

// -----------------------------------------------------------------------------------

// NEW ENDPOINT: GET /api/results/tally (BE-M4-01)
// NOTE: This endpoint should be protected by an 'ADMIN' or 'OFFICER' role in a real app,
// but for now, we'll keep it open for testing and development.
router.get('/tally', async (req, res) => {
    const dbClient = req.app.locals.dbClient;

    try {
        // SQL to aggregate votes, joining Candidates and Positions to get necessary details
        const queryText = `
            WITH RankedVotes AS (
                SELECT
                    p.id AS position_id,
                    p.name AS position_name,
                    p.seats,
                    c.id AS candidate_id,
                    c.name AS candidate_name,
                    COUNT(v.id) AS vote_count,
                    -- Rank candidates within each position by vote count (DESC)
                    ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY COUNT(v.id) DESC) as rank
                FROM
                    positions p
                JOIN
                    candidates c ON p.id = c.position_id
                LEFT JOIN
                    votes v ON c.id = v.candidate_id
                -- Only count votes for APPROVED candidates
                WHERE 
                    c.status = 'APPROVED'
                GROUP BY
                    p.id, p.name, p.seats, c.id, c.name
            )
            SELECT
                position_id,
                position_name,
                seats,
                candidate_id,
                candidate_name,
                vote_count::integer, -- Cast to integer for clean JSON
                rank,
                -- Determine winner based on rank vs. seats available
                CASE 
                    WHEN rank <= seats THEN 'WINNER'
                    ELSE 'LOSER'
                END AS result_status
            FROM
                RankedVotes
            ORDER BY
                position_id, vote_count DESC;
        `;

        const result = await dbClient.query(queryText);
        
        // Structure the results for the frontend
        const finalResults = {};
        let totalVotesCast = 0;
        
        result.rows.forEach(row => {
            const { position_id, position_name, seats, candidate_id, candidate_name, vote_count, result_status } = row;
            
            if (!finalResults[position_id]) {
                finalResults[position_id] = {
                    id: position_id,
                    name: position_name,
                    seats: seats,
                    candidates: [],
                    winners: 0
                };
            }
            
            // Tally the total votes cast across all positions (counting each candidate vote as 1)
            totalVotesCast += vote_count;

            finalResults[position_id].candidates.push({
                id: candidate_id,
                name: candidate_name,
                vote_count: vote_count,
                status: result_status
            });
            
            if (result_status === 'WINNER') {
                finalResults[position_id].winners += 1;
            }
        });
        
        // 2. Calculate Turnout (Optional but useful metric)
        // Find the number of unique Verifications that cast a vote (consumed their token)
        const turnoutQuery = `
            SELECT COUNT(id) AS total_voters_cast
            FROM Verifications
            WHERE consumed_at IS NOT NULL;
        `;
        const turnoutResult = await dbClient.query(turnoutQuery);
        const totalVotersCast = parseInt(turnoutResult.rows[0].total_voters_cast || 0);

        // Fetch total number of eligible voters
        const eligibleVotersQuery = `
            SELECT COUNT(id) AS total_eligible_voters
            FROM EligibleVoters
            WHERE status = 'ELIGIBLE';
        `;
        const eligibleVotersResult = await dbClient.query(eligibleVotersQuery);
        const totalEligibleVoters = parseInt(eligibleVotersResult.rows[0].total_eligible_voters || 0);
        
        // 3. Audit Log (Auditing Result Generation)
        await auditLog(
            dbClient, 
            'SYSTEM', 
            'AUTOMATED', 
            'RESULTS_GENERATED', 
            'Votes', 
            null,
            { positions_counted: Object.keys(finalResults).length, total_voters_cast: totalVotersCast }
        );

        // 4. Response
        res.status(200).json({
            meta: {
                timestamp: new Date().toISOString(),
                total_votes_cast: totalVotersCast,
                total_eligible_voters: totalEligibleVoters,
                turnout_percentage: totalEligibleVoters > 0 ? ((totalVotersCast / totalEligibleVoters) * 100).toFixed(2) : '0.00'
            },
            results: Object.values(finalResults)
        });

    } catch (err) {
        console.error('Error tallying election results:', err.message);
        res.status(500).json({ error: 'Failed to generate election results.' });
    }
});

module.exports = router;