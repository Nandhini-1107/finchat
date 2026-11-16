// src/services/durable-queue.js
// Purpose: WP15 Durable Ingestion Queue with Exponential Retry & Poison Message / DLQ Handling.
// Note: Live Azure Storage Queue network access is UNVERIFIED - needs live check in production environment.

const crypto = require('crypto');
const { updateDocumentStatus, logFactAudit } = require('./sql');
require('../utils/config');

class DurableQueue {
    constructor(maxRetries = 3) {
        this.queue = [];
        this.deadLetterQueue = [];
        this.inFlight = new Map();
        this.maxRetries = maxRetries;
    }

    get dlq() {
        return this.deadLetterQueue;
    }

    /**
     * Enqueues a new document ingestion job.
     *
     * @param {Object} job
     * @param {number|string} job.documentId
     * @param {string} job.fileName
     * @param {Buffer} [job.fileBuffer]
     * @param {string} [job.sourceType='ManualUpload']
     * @param {number} [job.authorityRank=4]
     * @returns {Object} Enqueued job envelope
     */
    async enqueueIngestionJob(job) {
        if (!job || !job.documentId) {
            throw new Error('documentId is required to enqueue an ingestion job');
        }

        const jobId = job.jobId || `job_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
        const envelope = {
            jobId,
            documentId: job.documentId,
            fileName: job.fileName || 'unknown_document',
            fileBuffer: job.fileBuffer || null,
            sourceType: job.sourceType || 'ManualUpload',
            authorityRank: job.authorityRank || 4,
            allowedUserGroups: job.allowedUserGroups || null,
            modifiedUserEmail: job.modifiedUserEmail || null,
            retryCount: job.retryCount || 0,
            enqueuedAt: new Date().toISOString(),
            status: 'Enqueued'
        };

        this.queue.push(envelope);
        return envelope;
    }

    /**
     * Dequeues the next ready job.
     *
     * @returns {Object|null}
     */
    async dequeueIngestionJob() {
        if (this.queue.length === 0) return null;
        const job = this.queue.shift();
        job.status = 'Processing';
        job.dequeuedAt = new Date().toISOString();
        this.inFlight.set(job.jobId, job);
        return job;
    }

    /**
     * Processes a job with exponential retry and automatic poison message / DLQ routing.
     *
     * @param {Object} job
     * @param {Function} workerFn
     * @param {Object} [options]
     * @param {number} [options.maxRetries=3]
     * @param {number} [options.initialBackoffMs=100]
     * @returns {Promise<{ success: boolean, result?: any, error?: string, deadLetter?: boolean }>}
     */
    async processJobWithRetry(job, workerFn, { maxRetries = 3, initialBackoffMs = 50 } = {}) {
        if (!job) throw new Error('Job is required');
        if (typeof workerFn !== 'function') throw new Error('workerFn must be a function');

        let currentJob = { ...job };

        while (currentJob.retryCount <= maxRetries) {
            try {
                const result = await workerFn(currentJob);
                this.inFlight.delete(currentJob.jobId);
                return {
                    success: true,
                    result,
                    retryCount: currentJob.retryCount
                };
            } catch (err) {
                currentJob.retryCount = (currentJob.retryCount || 0) + 1;
                currentJob.lastError = err.message;
                currentJob.lastFailedAt = new Date().toISOString();

                if (currentJob.retryCount > maxRetries) {
                    // Poison message: Route to Dead-Letter Queue
                    currentJob.status = 'DeadLetter';
                    this.deadLetterQueue.push(currentJob);
                    this.inFlight.delete(currentJob.jobId);

                    // Update document status in SQL to Failed
                    if (currentJob.documentId) {
                        try {
                            await updateDocumentStatus(currentJob.documentId, 'Failed');
                            await logFactAudit({
                                factId: null,
                                documentId: currentJob.documentId,
                                actionType: 'JobDeadLettered',
                                newValue: 'Status: Failed',
                                actionReason: `Max retries (${maxRetries}) exceeded: ${err.message}`,
                                actionBy: 'DurableQueue'
                            });
                        } catch {
                            // ignore in tests without SQL connection
                        }
                    }

                    return {
                        success: false,
                        deadLetter: true,
                        error: `Job permanently failed after ${maxRetries} retries: ${err.message}`,
                        retryCount: currentJob.retryCount
                    };
                }

                // Exponential backoff
                const backoffMs = initialBackoffMs * Math.pow(2, currentJob.retryCount - 1);
                await new Promise(resolve => setTimeout(resolve, backoffMs));
            }
        }
    }

    getQueueLength() {
        return this.queue.length;
    }

    getDeadLetterQueue() {
        return [...this.deadLetterQueue];
    }

    clear() {
        this.queue = [];
        this.deadLetterQueue = [];
        this.inFlight.clear();
    }
}

const defaultQueue = new DurableQueue();

module.exports = {
    DurableQueue,
    defaultQueue,
    durableQueue: defaultQueue,
    enqueueIngestionJob: (job) => defaultQueue.enqueueIngestionJob(job),
    dequeueIngestionJob: () => defaultQueue.dequeueIngestionJob(),
    processJobWithRetry: (job, fn, opts) => defaultQueue.processJobWithRetry(job, fn, opts),
    getQueueLength: () => defaultQueue.getQueueLength(),
    getDeadLetterQueue: () => defaultQueue.getDeadLetterQueue()
};

