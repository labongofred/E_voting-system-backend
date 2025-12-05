// backend/tests/candidate.test.js

const request = require('supertest');
const express = require('express');
// Assuming the server exports the router files
const candidateRoutes = require('../routes/candidate');
const adminRoutes = require('../routes/admin'); // Assuming positions CRUD is here
const app = express(); 

// Mock the DB Client
const mockDbClient = {
    query: jest.fn(), 
    connect: jest.fn(() => ({ // Mock for transaction support if needed
        query: jest.fn(), 
        release: jest.fn(), 
        // Mock specific commands for transactions
        // Note: For simplicity, we mostly mock the main dbClient.query below
    }))
};

// Set up the mock application instance
app.use(express.json()); 
app.use('/api/candidate', candidateRoutes);
app.use('/api/admin', adminRoutes);
app.locals.dbClient = mockDbClient; 

// Mock Multer's single file middleware to allow the route logic to execute
// Note: This is a simplification; a full test would use supertest's .attach()
jest.mock('multer', () => {
    const multer = () => ({
        single: () => (req, res, next) => {
            // Mock req.file and req.files for the test
            req.file = { path: '/uploads/test.pdf', originalname: 'test.pdf' };
            req.files = [{ fieldname: 'photo' }, { fieldname: 'manifesto' }];
            next();
        }
    });
    // Add the storage methods used by multer internally
    multer.diskStorage = () => {}; 
    return multer;
});


describe('Election API Integration Tests (10 Total)', () => {
    beforeEach(() => {
        mockDbClient.query.mockClear();
    });

    // --- Existing Test 1: Nomination Missing Fields (Validation) ---
    it('(1/10) should return 400 if required fields are missing during nomination', async () => {
        const payload = { candidate_name: 'Test Candidate' };
        
        const response = await request(app).post('/api/candidate/nominate').send(payload);

        // We expect this to fail the JSON validation before the DB is hit
        expect(response.statusCode).toBe(400); 
        expect(response.body).toHaveProperty('error');
    });

    // --- Existing Test 2: Successful Nomination Approval (Approval Logic) ---
    it('(2/10) should successfully approve a pending nomination', async () => {
        const candidateId = 101;
        
        mockDbClient.query.mockResolvedValueOnce({ 
            rowCount: 1, 
            rows: [{ id: candidateId, name: 'Test Candidate', status: 'APPROVED', voter_reg_no: 'DIT/23/001' }] 
        });

        const response = await request(app)
            .patch(`/api/candidate/${candidateId}/decision`)
            .send({ action: 'APPROVE' });

        expect(response.statusCode).toBe(200);
        expect(response.body.candidate.status).toBe('APPROVED');
    });

    // --- Existing Test 3: Successful Nomination Rejection (Approval Logic) ---
    it('(3/10) should successfully reject a pending nomination with a reason', async () => {
        const candidateId = 102;
        const reason = 'Failed eligibility check.';
        
        mockDbClient.query.mockResolvedValueOnce({ 
            rowCount: 1, 
            rows: [{ id: candidateId, name: 'Test Reject', status: 'REJECTED' }] 
        });

        const response = await request(app)
            .patch(`/api/candidate/${candidateId}/decision`)
            .send({ action: 'REJECT', reason: reason });

        expect(response.statusCode).toBe(200);
        expect(response.body.candidate.status).toBe('REJECTED');
    });

    // --- Existing Test 4: Rejection without Reason (Validation) ---
    it('(4/10) should return 400 if rejection reason is missing', async () => {
        const candidateId = 103;

        const response = await request(app)
            .patch(`/api/candidate/${candidateId}/decision`)
            .send({ action: 'REJECT' });

        expect(response.statusCode).toBe(400);
        expect(response.body).toHaveProperty('error', 'Reason is required for rejection.');
    });
    
    // --- Existing Test 5: Cannot Process Non-Pending Status (Validation/Logic) ---
    it('(5/10) should return 400 if the nomination is already processed', async () => {
        const candidateId = 104;
        
        // Mock the UPDATE query to affect 0 rows (because status != PENDING)
        mockDbClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
        
        const response = await request(app)
            .patch(`/api/candidate/${candidateId}/decision`)
            .send({ action: 'APPROVE' });

        expect(response.statusCode).toBe(400);
        expect(response.body).toHaveProperty('error', expect.stringContaining('already processed'));
    });

    // ----------------------------------------------------------------------
    // --- NEW TESTS (6-10) ---
    // ----------------------------------------------------------------------

    // --- NEW Test 6: Position Creation Success (CRUD) ---
    it('(6/10) should successfully create a new position', async () => {
        const positionPayload = { name: 'Treasurer', seats: 1 };
        
        // Mock DB to return the created position
        mockDbClient.query.mockResolvedValueOnce({ 
            rows: [{ id: 5, ...positionPayload }], rowCount: 1 
        });

        const response = await request(app)
            .post('/api/admin/positions')
            .send(positionPayload);

        expect(response.statusCode).toBe(201);
        expect(response.body.name).toBe('Treasurer');
        expect(mockDbClient.query).toHaveBeenCalledTimes(1);
    });

    // --- NEW Test 7: Position Creation Failure (Validation) ---
    it('(7/10) should return 400 if position name is missing on creation', async () => {
        const positionPayload = { seats: 1 };
        
        const response = await request(app)
            .post('/api/admin/positions')
            .send(positionPayload);

        expect(response.statusCode).toBe(400);
        expect(response.body).toHaveProperty('error', expect.stringContaining('required'));
        expect(mockDbClient.query).not.toHaveBeenCalled();
    });

    // --- NEW Test 8: Position Update Success (CRUD) ---
    it('(8/10) should successfully update an existing position', async () => {
        const positionId = 6;
        const updatePayload = { name: 'President', seats: 1 };
        
        // Mock DB to return the updated position
        mockDbClient.query.mockResolvedValueOnce({ 
            rows: [{ id: positionId, ...updatePayload }], rowCount: 1 
        });

        const response = await request(app)
            .put(`/api/admin/positions/${positionId}`)
            .send(updatePayload);

        expect(response.statusCode).toBe(200);
        expect(response.body.name).toBe('President');
    });

    // --- NEW Test 9: Position Deletion Failure (Dependency Check) ---
    it('(9/10) should return 400 if position has associated candidates (Dependency)', async () => {
        const positionId = 7;
        
        // Mock DB to simulate a foreign key violation or a pre-check
        // We simulate the DB returning a constraint error code (e.g., PostgreSQL 23503)
        mockDbClient.query.mockRejectedValueOnce({ code: '23503', detail: 'Key (id)=(7) is still referenced' }); 

        const response = await request(app).delete(`/api/admin/positions/${positionId}`);

        expect(response.statusCode).toBe(400);
        expect(response.body).toHaveProperty('error', expect.stringContaining('currently associated with candidates'));
    });

    // --- NEW Test 10: Nomination Submission Success (Full Save Logic) ---
    it('(10/10) should successfully submit a new candidate nomination', async () => {
        const candidatePayload = { 
            name: 'Test Nominee', 
            voter_reg_no: 'DIT/23/010', 
            position_id: 1,
            // Files are mocked by the global jest.mock('multer')
        };
        
        // Mock DB to return the inserted candidate
        mockDbClient.query.mockResolvedValueOnce({ 
            rows: [{ id: 200, status: 'PENDING', ...candidatePayload }], rowCount: 1 
        });

        const response = await request(app)
            .post('/api/candidate/nominate')
            .send(candidatePayload)
            .set('Content-Type', 'multipart/form-data'); // Must set content type for Multer mock

        expect(response.statusCode).toBe(201);
        expect(response.body.candidate.status).toBe('PENDING');
        expect(response.body.candidate.name).toBe('Test Nominee');
    });
});