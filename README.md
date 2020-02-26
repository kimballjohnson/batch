<h1 align=center>OpenAddresses Batch</h1>

## Deploy

Before you are able to deploy infrastructure you must first setup the [OpenAddresses Deploy tools](https://github.com/openaddresses/deploy)

Once these are installed, you can create the production stack via:
(Note: it should already exist!)

```sh
deploy create production
```

Or update to the latest GitSha or CloudFormation template via

```sh
deploy update production
```

### Paramaters

#### GitSha

On every commit, GitHub actions will build the latest Docker image and push it to the `batch` ECR.
This parameter will be populated automatically by the `deploy` cli and simply points the stack
to use the correspondingly Docker image from ECR.

## Components

The project is divided into several componenets

| Component | Purpose |
| --------- | ------- |
| cloudformation | Deploy Configuration |
| api | Dockerized server for handling all API interactions |
| cli | CLI for manually queueing work to batch |
| lambda | Lambda responsible for instantiating a batch job environement and submitting it |
| task | Docker container for running a batch job |

## API

All infrastructure in this repo must be used via the REST API. Individual
components should never be fired directly to ensure database state.

### Server

### GET `/`

Healthcheck, returns 200 if the server is healthy

#### GET `/api`

Returns high level info about the API

```JSON
{
    "version": "1.0.0"
}
```

### Runs

#### GET `/api/run`

Return information about a filtered set of runs

#### POST `/api/run`

Create a new run

#### GET `/api/run/<run>`

Get an individual run

#### PUT `/api/run/<run>`

Update an individual run

#### POST `/api/run/<run>/batch`

Given a source file, create jobs for all permutations
