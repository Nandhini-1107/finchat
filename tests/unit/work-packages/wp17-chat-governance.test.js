const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chatHandler } = require('../../../src/functions/chat');
const { setPool, resetPool } = require('../../../src/services/sql');
const modelClient = require('../../../src/services/model-client');

// Mock chatCompletion and embeddings for fast offline test execution
const originalChatCompletion = modelClient.chatCompletion;
modelClient.chatCompletion = async () => ({
    text: JSON.stringify({
        route: 'DIRECT_SQL',
        intentType: 'SINGLE_PERIOD_FACT',
        metrics: [],
        periods: [],
        isComparison: false,
        confidence: 0.95
    }),
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
});

const embeddings = require('../../../src/services/embeddings');
embeddings.generateEmbedding = async () => new Array(1536).fill(0.01);

function createMockHttpRequest({ body = {}, headers = {} }) {
    const hMap = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    return {
        method: 'POST',
        url: 'http://localhost/api/chat',
        headers: {
            get: (key) => hMap.get(key.toLowerCase()) || null
        },
        json: async () => body
    };
}

const mockContext = {
    log: () => {},
    warn: () => {},
    error: () => {}
};

test('WP17: Handler-Level Governance Statuses in English and Arabic', async (t) => {

    await t.test('1. OUT_OF_SCOPE_QUESTION: English non-financial question', async () => {
        const req = createMockHttpRequest({
            body: { question: 'What is the weather in Dubai today?' }
        });
        const res = await chatHandler(req, mockContext);
        assert.equal(res.status, 200);
        const body = JSON.parse(res.body);
        assert.equal(body.status, 'OUT_OF_SCOPE_QUESTION');
        assert.equal(body.governanceStatus, 'OUT_OF_SCOPE_QUESTION');
        assert.ok(body.answer.includes('out of scope'));
        assert.equal(body.insufficientEvidence, true);
    });

    await t.test('2. OUT_OF_SCOPE_QUESTION: Arabic non-financial question', async () => {
        const req = createMockHttpRequest({
            body: { question: 'ما هي أحوال الطقس اليوم في دبي؟' }
        });
        const res = await chatHandler(req, mockContext);
        assert.equal(res.status, 200);
        const body = JSON.parse(res.body);
        assert.equal(body.status, 'OUT_OF_SCOPE_QUESTION');
        assert.equal(body.governanceStatus, 'OUT_OF_SCOPE_QUESTION');
        assert.ok(body.answer.includes('خارج نطاق الخدمة'));
        assert.equal(body.insufficientEvidence, true);
    });

    await t.test('3. NEEDS_CLARIFICATION: English ambiguous query', async () => {
        const req = createMockHttpRequest({
            body: { question: 'Please clarify which entity report is this?' }
        });
        const res = await chatHandler(req, mockContext);
        assert.equal(res.status, 200);
        const body = JSON.parse(res.body);
        assert.equal(body.status, 'NEEDS_CLARIFICATION');
        assert.equal(body.governanceStatus, 'NEEDS_CLARIFICATION');
        assert.ok(body.answer.includes('clarify'));
        assert.equal(body.insufficientEvidence, true);
    });

    await t.test('4. NEEDS_CLARIFICATION: Arabic ambiguous query', async () => {
        const req = createMockHttpRequest({
            body: { question: 'يرجى توضيح أي شركة المقصودة هنا؟' }
        });
        const res = await chatHandler(req, mockContext);
        assert.equal(res.status, 200);
        const body = JSON.parse(res.body);
        assert.equal(body.status, 'NEEDS_CLARIFICATION');
        assert.equal(body.governanceStatus, 'NEEDS_CLARIFICATION');
        assert.ok(body.answer.includes('توضيح'));
        assert.equal(body.insufficientEvidence, true);
    });

    await t.test('5. DOCUMENT_BEING_PREPARED: English preparing document', async () => {
        const mockPreparingDoc = {
            DocumentId: 301,
            FileName: 'Contoso_Q1_2026_Ingesting.xlsx',
            IngestionStatus: 'Processing',
            IndexingStatus: 'Indexing',
            ConflictHold: 0
        };

        const mockPool = {
            connected: true,
            request: () => ({
                input: () => mockPool.request(),
                query: async (q) => {
                    if (q.includes('FROM dbo.Documents') && q.includes('DocumentId = @DocumentId')) {
                        return { recordset: [mockPreparingDoc] };
                    }
                    return { recordset: [] };
                }
            })
        };

        setPool(mockPool);
        try {
            const req = createMockHttpRequest({
                body: {
                    question: 'What is the Revenue in Contoso_Q1_2026_Ingesting.xlsx?',
                    documentId: 301
                }
            });
            const res = await chatHandler(req, mockContext);
            assert.equal(res.status, 200);
            const body = JSON.parse(res.body);
            assert.equal(body.status, 'DOCUMENT_BEING_PREPARED');
            assert.equal(body.governanceStatus, 'DOCUMENT_BEING_PREPARED');
            assert.ok(body.answer.includes('currently being prepared'));
            assert.equal(body.insufficientEvidence, true);
        } finally {
            resetPool();
        }
    });

    await t.test('6. DOCUMENT_BEING_PREPARED: Arabic query for preparing document', async () => {
        const mockPreparingDoc = {
            DocumentId: 302,
            FileName: 'Contoso_Arabic_Pack.xlsx',
            IngestionStatus: 'Processing',
            IndexingStatus: 'Indexing',
            ConflictHold: 0
        };

        const mockPool = {
            connected: true,
            request: () => ({
                input: () => mockPool.request(),
                query: async (q) => {
                    if (q.includes('FROM dbo.Documents') && q.includes('DocumentId = @DocumentId')) {
                        return { recordset: [mockPreparingDoc] };
                    }
                    return { recordset: [] };
                }
            })
        };

        setPool(mockPool);
        try {
            const req = createMockHttpRequest({
                body: {
                    question: 'ما هي إيرادات شركة كونتوسو في الملف قيد المعالجة؟',
                    documentId: 302
                }
            });
            const res = await chatHandler(req, mockContext);
            assert.equal(res.status, 200);
            const body = JSON.parse(res.body);
            assert.equal(body.status, 'DOCUMENT_BEING_PREPARED');
            assert.equal(body.governanceStatus, 'DOCUMENT_BEING_PREPARED');
            assert.ok(body.answer.includes('قيد الإعداد'));
            assert.equal(body.insufficientEvidence, true);
        } finally {
            resetPool();
        }
    });

    await t.test('7. NO_APPROVED_EVIDENCE: English query when no approved facts or chunks match', async () => {
        const mockApprovedDoc = {
            DocumentId: 401,
            FileName: 'Contoso_Audited_Annual.pdf',
            IngestionStatus: 'Succeeded',
            IndexingStatus: 'Indexed',
            ConflictHold: 0
        };

        const mockPool = {
            connected: true,
            request: () => ({
                input: () => mockPool.request(),
                query: async (q) => {
                    if (q.includes('FROM dbo.Documents') && q.includes('DocumentId = @DocumentId')) {
                        return { recordset: [mockApprovedDoc] };
                    }
                    // Return empty facts for an unmentioned metric
                    return { recordset: [] };
                }
            })
        };

        setPool(mockPool);
        try {
            const req = createMockHttpRequest({
                body: {
                    question: 'What was the Cryptocurrency Holdings balance in FY2026?',
                    documentId: 401
                }
            });
            const res = await chatHandler(req, mockContext);
            assert.equal(res.status, 200);
            const body = JSON.parse(res.body);
            assert.equal(body.status, 'NO_APPROVED_EVIDENCE');
            assert.equal(body.governanceStatus, 'NO_APPROVED_EVIDENCE');
            assert.ok(body.answer.includes('No approved evidence'));
            assert.equal(body.insufficientEvidence, true);
        } finally {
            resetPool();
        }
    });

    await t.test('8. NO_APPROVED_EVIDENCE: Arabic query when no approved facts match', async () => {
        const mockApprovedDoc = {
            DocumentId: 402,
            FileName: 'Contoso_Audited_Annual.pdf',
            IngestionStatus: 'Succeeded',
            IndexingStatus: 'Indexed',
            ConflictHold: 0
        };

        const mockPool = {
            connected: true,
            request: () => ({
                input: () => mockPool.request(),
                query: async (q) => {
                    if (q.includes('FROM dbo.Documents') && q.includes('DocumentId = @DocumentId')) {
                        return { recordset: [mockApprovedDoc] };
                    }
                    return { recordset: [] };
                }
            })
        };

        setPool(mockPool);
        try {
            const req = createMockHttpRequest({
                body: {
                    question: 'ما هو رصيد العملات الرقمية المشفرة في عام 2026؟',
                    documentId: 402
                }
            });
            const res = await chatHandler(req, mockContext);
            assert.equal(res.status, 200);
            const body = JSON.parse(res.body);
            assert.equal(body.status, 'NO_APPROVED_EVIDENCE');
            assert.equal(body.governanceStatus, 'NO_APPROVED_EVIDENCE');
            assert.ok(body.answer.includes('لم يتم العثور'));
            assert.equal(body.insufficientEvidence, true);
        } finally {
            resetPool();
        }
    });
});
