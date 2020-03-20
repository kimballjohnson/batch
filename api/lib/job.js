'use strict';

const Err = require('./error');
const AWS = require('aws-sdk');

const s3 = new AWS.S3({ region: process.env.AWS_DEFAULT_REGION });
const cwl = new AWS.CloudWatchLogs({ region: process.env.AWS_DEFAULT_REGION });
const lambda = new AWS.Lambda({ region: process.env.AWS_DEFAULT_REGION });

class Job {
    constructor(run, source, layer, name) {
        this.id = false,
        this.run = run;
        this.created = false;
        this.source = source;
        this.layer = layer;
        this.name = name;
        this.output = false;
        this.loglink = false;
        this.status = 'Pending';
        this.version = '0.0.0';

        // Attributes which are allowed to be patched
        this.attrs = ['output', 'loglink', 'status', 'version'];
    }

    json() {
        return {
            id: parseInt(this.id),
            run: parseInt(this.run),
            created: this.created,
            source: this.source,
            layer: this.layer,
            name: this.name,
            output: this.output,
            loglink: this.loglink,
            status: this.status,
            version: this.version
        };
    }
    static list(pool) {
        return new Promise((resolve, reject) => {
            pool.query(`
                SELECT
                    *
                FROM
                    job
                ORDER BY
                    created DESC
                LIMIT 100
            `, (err, pgres) => {
                if (err) return reject(new Err(500, err, 'failed to load jobs'));

                if (!pgres.rows.length) {
                    return reject(new Err(404, null, 'no job by that id'));
                }

                return resolve(pgres.rows.map((job) => {
                    job.id = parseInt(job.id);

                    return job;
                }));
            });
        });
    }

    static from(pool, id) {
        return new Promise((resolve, reject) => {
            pool.query(`
                SELECT
                    *
                FROM
                    job
                WHERE
                    id = $1
            `, [id], (err, pgres) => {
                if (err) return reject(new Err(500, err, 'failed to load job'));

                if (!pgres.rows.length) {
                    return reject(new Err(404, null, 'no job by that id'));
                }

                const job = new Job();

                for (const key of Object.keys(pgres.rows[0])) {
                    job[key] = pgres.rows[0][key];
                }

                return resolve(job);
            });
        });
    }

    patch(patch) {
        for (const attr of this.attrs) {
            if (patch[attr] !== undefined) {
                this[attr] = patch[attr];
            }
        }
    }

    static preview(job_id) {
        return s3.getObject({
            Bucket: process.env.Bucket,
            Key: `${process.env.StackName}/job/${job_id}/source.png`
        }).createReadStream()
    }

    static data(job_id) {
        return s3.getObject({
            Bucket: process.env.Bucket,
            Key: `${process.env.StackName}/job/${job_id}/source.geojson.gz`
        }).createReadStream()
    }

    static cache(job_id) {
        return s3.getObject({
            Bucket: process.env.Bucket,
            Key: `${process.env.StackName}/job/${job_id}/cache.zip`
        }).createReadStream()
    }

    commit(pool) {
        return new Promise((resolve, reject) => {
            pool.query(`
                UPDATE job
                    SET
                        output = $1,
                        loglink = $2,
                        status = $3,
                        version = $4
                    WHERE
                        id = $5
            `, [this.output, this.loglink, this.status, this.version, this.id], (err) => {
                if (err) return reject(new Err(500, err, 'failed to save job'));

                return resolve(this);
            });
        });
    }

    log() {
        return new Promise((resolve, reject) => {
            if (!this.loglink) return reject(new Err(404, null, 'Job has not produced a log'));

            cwl.getLogEvents({
                logGroupName: '/aws/batch/job',
                logStreamName: this.loglink
            }, (err, res) => {
                if (err) return reject(new Err(500, err, 'Could not retrieve logs' ));

                let line = 0;
                return resolve(res.events.map((event) => {
                    return {
                        id: ++line,
                        timestamp: event.timestamp,
                        message: event.message
                            .replace(/[ps]k\.[A-Za-z0-9.-]+/, '<REDACTED>')
                    };
                }));
            });
        });
    }

    generate(pool) {
        return new Promise((resolve, reject) => {
            if (!this.run) return reject(new Err(400, null, 'Cannot generate a job without a run'));
            if (!this.source) return reject(new Err(400, null, 'Cannot generate a job without a source'));
            if (!this.layer) return reject(new Err(400, null, 'Cannot generate a job without a layer'));
            if (!this.name) return reject(new Err(400, null, 'Cannot generate a job without a name'));

            pool.query(`
                INSERT INTO job (
                    run,
                    created,
                    source,
                    layer,
                    name,
                    status,
                    version
                ) VALUES (
                    $1,
                    NOW(),
                    $2,
                    $3,
                    $4,
                    'Pending',
                    $5
                ) RETURNING *
            `, [
                this.run,
                this.source,
                this.layer,
                this.name,
                this.version
            ], (err, pgres) => {
                if (err) return reject(new Err(500, err, 'failed to generate job'));

                for (const key of Object.keys(pgres.rows[0])) {
                    this[key] = pgres.rows[0][key];
                }

                return resolve(this);
            });
        });
    }

    batch() {
        return new Promise((resolve, reject) => {
            if (!this.id) return reject(new Err(400, null, 'Cannot batch a job without an ID'));

            if (process.env.StackName === 'test') {
                return resolve(true);
            } else {
                lambda.invoke({
                    FunctionName: `${process.env.StackName}-invoke`,
                    InvocationType: 'Event',
                    LogType: 'Tail',
                    Payload: JSON.stringify({
                        job: this.id,
                        source: this.source,
                        layer: this.layer,
                        name: this.name
                    })
                }, (err, data) => {
                    if (err) return reject(new Err(500, err, 'failed to submit job to batch'));

                    return resolve(data);
                });
            }
        });
    }
}

module.exports = Job;
