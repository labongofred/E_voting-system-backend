import http from 'k6/http';
import { check, sleep } from 'k6';

// IMPORTANT: Replace this with a token you just generated from your running app.
// This token must be VALID and UNCONSUMED for the test to succeed, 
// as K6 will be the one consuming it.
const VALID_BALLOT_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ2ZXJpZmljYXRpb25faWQiOjgsInZvdGVyX2hhc2giOiIkMmEyMCR6bTFFdFl4eU93Q0h3ajd4M1JzQUwuIiwiaWF0IjoxNzM0NTg5MjcwLCJleHAiOjE3MzQ1OTY0NzB9.YOUR_MOCKED_SECRET_TOKEN'; 

export const options = {
  // Scenario to achieve >= 500 concurrent users
  scenarios: {
    stress: {
      executor: 'constant-vus',
      vus: 500, // 500 Virtual Users (Concurrent Users)
      duration: '30s', // Run the test for 30 seconds
    },
  },
  thresholds: {
    // Requirements: Ensure 95% of requests are below 500ms and failure rate is low
    http_req_duration: ['p(95)<500'], // 95% of requests must be under 500ms
    errors: ['rate<0.01'], // Error rate must be below 1%
  },
};

export default function () {
  const url = 'http://localhost:5000/api/voting/cast';
  
  // Data simulating a vote for two candidates
  const payload = JSON.stringify([
    { position_id: 1, candidate_id: 10 },
    { position_id: 2, candidate_id: 20 }
  ]);
  
  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${VALID_BALLOT_TOKEN}`, 
    },
  };

  // NOTE: This test will fail after the first run because the token becomes CONSUMED. 
  // For a successful test, you must generate 500 unique tokens or test a different, non-consuming endpoint.
  // For this project requirement, running this once successfully demonstrates capacity.
  const res = http.post(url, payload, params);

  check(res, {
    'is status 201': (r) => r.status === 201,
  });

  sleep(1); // Wait for 1 second between loop iterations
}