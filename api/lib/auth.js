'use strict';

const Err = require('./error');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

class Auth {
    constructor(pool) {
        this.pool = pool;

        this.attrs = [
            'flags',
            'access'
        ];
    }

    async is_auth(req) {
        if (!req.auth || !req.auth.access || !['session', 'token'].includes(req.auth.type)) {
            throw new Err(401, null, 'Authentication Required');
        }

        return true;
    }

    async is_flag(req, flag) {
        await this.is_auth(req);

        if ((!req.auth.flags || !req.auth.flags[flag]) && req.auth.access !== 'admin') {
            throw new Err(401, null, `${flag} flag required`);
        }

        return true;
    }

    async is_admin(req) {
        if (!req.auth || !req.auth.access || req.auth.access !== 'admin') {
            throw new Err(401, null, 'Admin token required');
        }

        return true;
    }

    async patch(uid, patch) {
        const user = await this.user(uid);

        for (const attr of this.attrs) {
            if (patch[attr] !== undefined) {
                user[attr] = patch[attr];
            }
        }

        let pgres;
        try {
            pgres = await this.pool.query(`
                UPDATE users
                    SET
                        flags = $2,
                        access = $3

                    WHERE
                        id = $1
                    RETURNING *
            `, [
                uid,
                user.flags,
                user.access
            ]);
        } catch (err) {
            throw new Err(500, err, 'Internal User Error');
        }

        const row = pgres.rows[0];

        return {
            id: parseInt(row.id),
            username: row.username,
            email: row.email,
            access: row.access,
            flags: row.flags
        };
    }

    async list() {
        let pgres;
        try {
            pgres = await this.pool.query(`
                SELECT
                    id,
                    username,
                    access,
                    email,
                    flags
                FROM
                    users
            `, []);
        } catch (err) {
            throw new Err(500, err, 'Internal User Error');
        }

        return pgres.rows.map((row) => {
            return {
                id: parseInt(row.id),
                username: row.username,
                email: row.email,
                access: row.access,
                flags: row.flags
            };
        });
    }

    async user(uid) {
        let pgres;
        try {
            pgres = await this.pool.query(`
                SELECT
                    id,
                    username,
                    access,
                    email,
                    flags
                FROM
                    users
                WHERE
                    id = $1
            `, [
                uid
            ]);
        } catch (err) {
            throw new Err(500, err, 'Internal User Error');
        }

        if (pgres.rows.length === 0) {
            throw new Error(404, null, 'Failed to retrieve user');
        }

        return {
            username: pgres.rows[0].username,
            email: pgres.rows[0].email,
            access: pgres.rows[0].access,
            flags: pgres.rows[0].flags
        };
    }

    async login(user) {
        if (!user.username) throw new Err(400, null, 'username required');
        if (!user.password) throw new Err(400, null, 'password required');

        if (user.username === 'internal') throw new Err(400, null, '"internal" is not a valid username');

        let pgres;
        try {
            pgres = await this.pool.query(`
                SELECT
                    id,
                    username,
                    access,
                    email,
                    password,
                    flags
                FROM
                    users
                WHERE
                    username = $1 OR
                    email = $1;
            `, [
                user.username
            ]);
        } catch (err) {
            throw new Err(500, err, 'Internal Login Error');
        }

        if (pgres.rows.length === 0) {
            throw new Error(403, null, 'Invalid Username or Pass');
        }

        return new Promise((resolve, reject) => {
            bcrypt.compare(user.password, pgres.rows[0].password, (err, res) => {
                if (err) return reject(new Err(500, err, 'Internal Login Error'));
                if (!res) return reject(new Error(403, null, 'Invalid Username or Pass'));

                return resolve({
                    uid: parseInt(pgres.rows[0].id),
                    username: pgres.rows[0].username,
                    access: pgres.rows[0].access,
                    email: pgres.rows[0].email,
                    flags: pgres.rows[0].flags
                });
            });
        });
    }

    async register(user) {
        if (!user.username) throw new Err(400, null, 'username required');
        if (!user.password) throw new Err(400, null, 'password required');
        if (!user.email) throw new Err(400, null, 'email required');

        if (user.username === 'internal') throw new Err(400, null, '"internal" is not a valid username');

        return new Promise((resolve, reject) => {
            bcrypt.hash(user.password, 10, (err, hash) => {
                if (err) return reject(new Err(500, err, 'Failed to hash password'));

                this.pool.query(`
                    INSERT INTO users (
                        username,
                        email,
                        password,
                        access,
                        flags
                    ) VALUES (
                        $1,
                        $2,
                        $3,
                        'user',
                        '{}'::JSONB
                    )
                `, [
                    user.username,
                    user.email,
                    hash
                ], (err) => {
                    if (err) return reject(new Err(500, err, 'Failed to create user'));

                    return resolve({
                        status: 200,
                        message: 'User Created'
                    });
                });
            });
        });
    }
}

class AuthToken {
    constructor(pool) {
        this.pool = pool;
    }

    async delete(auth, token_id) {
        if (!auth.uid) {
            throw new Err(500, null, 'Server could not determine user id');
        }

        try {
            await this.pool.query(`
                DELETE FROM
                    users_tokens
                WHERE
                    uid = $1
                    AND id = $2
            `, [
                auth.uid,
                token_id
            ]);

            return {
                status: 200,
                message: 'Token Deleted'
            };

        } catch (err) {
            throw new Err(500, err, 'Failed to delete token');
        }
    }

    async validate(token) {
        if (token.split('.').length !== 2 || token.split('.')[0] !== 'oa' || token.length !== 67) {
            throw new Err(401, null, 'Invalid token');
        }

        let pgres;
        try {
            pgres = await this.pool.query(`
                SELECT
                    users.id AS uid,
                    users.username,
                    users.access,
                    users.email,
                    users.flags
                FROM
                    users_tokens INNER JOIN users
                        ON users.id = users_tokens.uid
                WHERE
                    users_tokens.token = $1
            `, [
                token
            ]);
        } catch (err) {
            throw new Err(500, err, 'Failed to validate token');
        }

        if (!pgres.rows.length) {
            throw new Err(401, null, 'Invalid token');
        } else if (pgres.rows.length > 1) {
            throw new Err(401, null, 'Token collision');
        }

        return {
            uid: parseInt(pgres.rows[0].uid),
            username: pgres.rows[0].username,
            access: pgres.rows[0].access,
            email: pgres.rows[0].email
        };
    }

    async list(auth) {
        if (!auth.uid) {
            throw new Err(500, null, 'Server could not determine user id');
        }

        try {
            const pgres = await this.pool.query(`
                SELECT
                    id,
                    created,
                    name
                FROM
                    users_tokens
                WHERE
                    uid = $1
            `, [
                auth.uid
            ]);

            return pgres.rows.map((token) => {
                token.id = parseInt(token.id);

                return token;
            });
        } catch (err) {
            throw new Err(500, err, 'Failed to list tokens');
        }
    }

    async generate(auth, name) {
        if (auth.type !== 'session') {
            throw new Err(400, null, 'Only a user session can create a token');
        } else if (!auth.uid) {
            throw new Err(500, null, 'Server could not determine user id');
        } else if (!name || !name.trim()) {
            throw new Err(400, null, 'Token name required');
        }

        try {
            const pgres = await this.pool.query(`
                INSERT INTO users_tokens (
                    token,
                    created,
                    uid,
                    name
                ) VALUES (
                    $1,
                    NOW(),
                    $2,
                    $3
                ) RETURNING *
            `, [
                'oa.' + crypto.randomBytes(32).toString('hex'),
                auth.uid,
                name
            ]);

            return {
                id: parseInt(pgres.rows[0].id),
                name: pgres.rows[0].name,
                token: pgres.rows[0].token,
                created: pgres.rows[0].created
            };
        } catch (err) {
            throw new Err(500, err, 'Failed to generate token');
        }
    }
}

module.exports = {
    Auth,
    AuthToken
};
