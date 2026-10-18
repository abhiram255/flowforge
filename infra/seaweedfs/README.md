# SeaweedFS — bundled S3-compatible object storage

Used for the S3 driver integration test (locally and in CI: `docker run chrislusf/seaweedfs
server -s3 -s3.config=/etc/seaweedfs/s3.json -dir=/data`) and, in `docker-compose.prod.yml`,
as the shared attachment store for multi-replica deployments.

`s3.json` defines the S3 identities. The committed credentials are **development/test
defaults** — rotate them for any real deployment, exactly like `JWT_ACCESS_SECRET`.
