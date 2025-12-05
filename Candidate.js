// ... existing imports ...

// NEW ENDPOINT: GET /api/candidate (BE-M2-05 helper) - Fetch all nominations
router.get('/', async (req, res) => {
    const dbClient = req.app.locals.dbClient;
    // NOTE: This route should eventually be protected by an 'Officer' or 'Admin' role check
    
    try {
        const queryText = `
            SELECT 
                c.id, c.name, c.voter_reg_no, c.position_id, c.status, c.reason, 
                c.photo_url, c.manifesto_url, p.name AS position_name
            FROM 
                candidates c
            JOIN 
                positions p ON c.position_id = p.id
            ORDER BY 
                c.created_at DESC;
        `;
        const result = await dbClient.query(queryText);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching all nominations:', err.message);
        res.status(500).json({ error: 'Failed to fetch candidate nominations.' });
    }
});

// ... existing POST and PATCH endpoints ...