// src/functions/adminConflicts.js
// Admin HTTP endpoint for retrieving active and escalated conflicts across the organization.
const { app } = require('@azure/functions');
const { getPool } = require('../services/sql');
require('../utils/config');

// Route: 'conflicts/admin' (avoids Azure Functions reserved 'admin/' prefix; alias: 'admin/conflicts')
app.http('adminConflicts', {
    methods: ['GET'],
    authLevel: 'function',
    route: 'conflicts/admin',
    handler: async (request, context) => {
        const correlationId = request.headers.get('x-correlation-id') || `admin-${Date.now()}`;
        context.log(`[${correlationId}] GET /api/conflicts/admin invoked`);

        try {
            const p = await getPool();
            const res = await p.request().query(`
                SELECT 
                    c.ConflictId,
                    c.ConflictStatus,
                    c.ConflictType,
                    c.DifferenceValue,
                    c.DifferencePercentage,
                    c.ReissueCount,
                    c.NotificationStatus,
                    c.NotificationRecipient,
                    c.NotificationRetryCount,
                    c.DetectedAt,
                    c.UpdatedAt,
                    d.DocumentId,
                    d.FileName,
                    d.ConflictHold,
                    d.DocumentStatus
                FROM dbo.FactConflicts c
                LEFT JOIN dbo.Documents d ON c.IncomingDocumentId = d.DocumentId
                ORDER BY c.DetectedAt DESC
            `);

            const conflicts = res.recordset || [];
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    totalConflicts: conflicts.length,
                    activeConflicts: conflicts.filter(c => !['Resolved', 'Moot'].includes(c.ConflictStatus)).length,
                    escalatedConflicts: conflicts.filter(c => c.ConflictStatus === 'Escalated').length,
                    conflicts,
                    correlationId
                })
            };
        } catch (err) {
            context.error(`[${correlationId}] Failed to fetch admin conflicts: ${err.message}`);
            return {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    error: err.message,
                    correlationId
                })
            };
        }
    }
});

