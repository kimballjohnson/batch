#!/usr/bin/env node

'use strict';

const prompt = require('prompts');
const { promisify } = require('util');
const request = promisify(require('request'));

const args = require('minimist')(process.argv, {
    boolean: ['help'],
    string: ['api', 'url', 'layer', 'name', 'token']
});

cli();

async function cli() {
    const params = await prompt([{
        name: 'api',
        message: 'batch api to queue to',
        required: true,
        type: 'text',
        initial: args.api
    },{
        name: 'url',
        message: 'URL of source to send to batch',
        required: true,
        type: 'text',
        initial: args.url
    }]);

    const url = params.url;
    const api = params.api;

    let source = await request({
        url: url,
        method: 'GET',
        json: true
    });

    source = source.body;

    if (!source.schema || source.schema !== 2) {
        throw new Error('Batch can only process Schema V2 sources');
    }

    let layer;
    if (Object.keys(source.layers).length > 1) {
        layer = await prompt([{
            name: 'layer',
            message: 'Source layer to send to batch',
            required: true,
            type: 'select',
            choices: Object.keys(source.layers).map((layer) => {
                return {
                    title: layer,
                    value: layer
                };
            })
        }]);

        layer = layer.layer;
    } else {
        layer = Object.keys(source.layers)[0];
    }

    let name;
    if (Object.keys(source.layers[layer]).length > 1) {
        name = await prompt([{
            name: 'name',
            message: 'Layer Name',
            required: true,
            type: 'select',
            choices: source.layers[layer].map((name) => {
                return {
                    title: name.name,
                    value: name.name
                };
            })
        }]);

        name = name.name;
    } else {
        name = source.layers[layer][0].name;
    }

    try {
        const run = await request({
            url: api + '/api/run',
            method: 'POST',
            headers: {
                Authorization: `Bearer ${args.token}`
            },
            json: true,
            body: {
                live: true
            }
        });

        if (run.statusCode !== 200) {
            console.error(run.body.message);
            process.exit(1);
        }

        const job = await request({
            url: api + `/api/run/${run.body.id}/jobs`,
            method: 'POST',
            headers: {
                Authorization: `Bearer ${args.token}`
            },
            json: true,
            body: {
                jobs: [{
                    source: url,
                    layer: layer,
                    name: name
                }]
            }
        });
        if (run.statusCode !== 200) {
            console.error(run.body.message);
            process.exit(1);
        }

        console.error(job.body);
    } catch (err) {
        console.error(err);
    }
}
