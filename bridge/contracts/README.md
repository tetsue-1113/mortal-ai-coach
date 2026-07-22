# API v1 contracts

- `api.mjs`: version and canonical route names
- `scene.schema.json`: scene DTO sent by the Mortal page adapter
- `question-request.schema.json`: follow-up question request
- `hanchan-summary-request.schema.json`: hanchan summary request
- `stream-event.schema.json`: newline-delimited response events
- `error.schema.json`: non-streaming HTTP errors

Runtime validation and derived-field calculation are implemented by `application/scene-service.mjs`. Provider output schemas remain in the bridge root because they are passed directly to the CLI tools.
