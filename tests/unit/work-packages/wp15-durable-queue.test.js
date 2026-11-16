// tests/wp15-durable-queue.test.js
// Test Suite for WP15: Durable Ingestion Queue with Exponential Retry & DLQ

const test = require('node:test');
const assert = require('node:assert/strict');

const { DurableQueue } = require('../../../src/services/durable-queue');
const { setPool, resetPool } = require('../../../src/services/sql');

test('WP15: Durable Ingestion Queue with Exponential Retry & DLQ', async (t) => {

    await t.test('1. enqueue & dequeue: Preserves job FIFO order and transitions status', async () => {
        const queue = new DurableQueue();
        const job1 = await queue.enqueueIngestionJob({ documentId: 101, fileName: 'doc1.pdf' });
        const job2 = await queue.enqueueIngestionJob({ documentId: 102, fileName: 'doc2.xlsx' });

        assert.equal(queue.getQueueLength(), 2);
        assert.equal(job1.status, 'Enqueued');

        const dequeued1 = await queue.dequeueIngestionJob();
        assert.equal(dequeued1.documentId, 101);
        assert.equal(dequeued1.status, 'Processing');
        assert.equal(queue.getQueueLength(), 1);

        const dequeued2 = await queue.dequeueIngestionJob();
        assert.equal(dequeued2.documentId, 102);
        assert.equal(queue.getQueueLength(), 0);
    });

    await t.test('2. processJobWithRetry: Transient error succeeds within maxRetries', async () => {
        const queue = new DurableQueue();
        const job = await queue.enqueueIngestionJob({ documentId: 103, fileName: 'transient.xlsx' });

        let attempts = 0;
        const workerFn = async (currentJob) => {
            attempts++;
            if (attempts < 3) {
                throw new Error(`Transient database connection drop (attempt ${attempts})`);
            }
            return { processedFacts: 15 };
        };

        const res = await queue.processJobWithRetry(job, workerFn, { maxRetries: 3, initialBackoffMs: 10 });
        assert.equal(res.success, true);
        assert.equal(attempts, 3);
        assert.equal(res.result.processedFacts, 15);
        assert.equal(queue.getDeadLetterQueue().length, 0);
    });

    await t.test('3. processJobWithRetry: Poison message routes to Dead-Letter Queue (DLQ) after exceeding maxRetries', async () => {
        const queue = new DurableQueue();
        const job = await queue.enqueueIngestionJob({ documentId: 104, fileName: 'corrupt.pdf' });

        let updatedDocStatus = null;
        const mockPool = {
            connected: true,
            request: () => ({
                input: (name, type, val) => {
                    if (name === 'Status') updatedDocStatus = val;
                    return mockPool.request();
                },
                query: async () => ({ rowsAffected: [1] })
            })
        };
        setPool(mockPool);

        let attempts = 0;
        const poisonWorkerFn = async () => {
            attempts++;
            throw new Error('Fatal corrupted byte stream in page 4');
        };

        const res = await queue.processJobWithRetry(job, poisonWorkerFn, { maxRetries: 2, initialBackoffMs: 10 });
        assert.equal(res.success, false);
        assert.equal(res.deadLetter, true);
        assert.equal(attempts, 3); // initial attempt + 2 retries
        assert.ok(res.error.includes('permanently failed after 2 retries'));

        const dlq = queue.getDeadLetterQueue();
        assert.equal(dlq.length, 1);
        assert.equal(dlq[0].documentId, 104);
        assert.equal(dlq[0].status, 'DeadLetter');
        assert.equal(updatedDocStatus, 'Failed');

        resetPool();
    });
});

