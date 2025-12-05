// ... existing imports ...
const adminRoutes = require('./routes/admin');
const candidateRoutes = require('./routes/candidate');
const verifyRoutes = require('./routes/verify');
const votingRoutes = require('./routes/voting'); // <--- ADD THIS

// ... existing app.use() setup ...

app.use('/api/admin', adminRoutes);
app.use('/api/candidate', candidateRoutes);
app.use('/api/verify', verifyRoutes);
app.use('/api/voting', votingRoutes); // <--- ADD THIS

// ... rest of the file ...