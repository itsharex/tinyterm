# No-Tar SSH Test Container

This image intentionally removes `tar` to validate TinyTerm's fallback folder transfer path (recursive SFTP).

## Build

```bash
docker build -t tinyterm-test-no-tar -f docker-test/no-tar/Dockerfile .
```

## Run

```bash
docker run --rm -d --name tinyterm-no-tar -p 2223:22 tinyterm-test-no-tar
```

## Verify tar is unavailable

```bash
docker exec tinyterm-no-tar sh -lc "command -v tar || echo tar-not-found"
```

Expected output: `tar-not-found`

## Test account

- Host: `127.0.0.1`
- Port: `2223`
- Username: `testuser`
- Password: `test123`

## Cleanup

```bash
docker rm -f tinyterm-no-tar
```
