# NodeChat WebSocket Server

## Environment variables

- `AUTH_SECRET` (or `JWT_SECRET`/`NEXTAUTH_SECRET`) – used to verify WS tokens
- `WS_PORT` – port to listen on (default `4001`)
- `WS_TTL_SECONDS` – message buffer TTL (default `300`)
- `WS_HEARTBEAT_INTERVAL_MS` – heartbeat interval (default `25000`)
