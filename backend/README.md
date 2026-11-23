# Arabic story and AI chat service

The app uses this Railway backend for Arabic Fusha conversion and a short-turn AI story companion.

## Railway deployment

- Repository: `shady981981-hub/qissati-bisoora-apk`
- Service root directory: `/backend`
- Deploy branch: `main`
- Start command: `npm start`
- Health check: `/health`
- Routes: `POST /convert` and `POST /chat`

The production domain is configured in `index.html`. The conversion route is `/convert`; the story chat route is `/chat`.

Set `OPENAI_API_KEY` as a Railway secret, never in the APK or GitHub. The service returns `503` until this secret exists. Optionally set `OPENAI_MODEL`. Never expose secrets in logs or commit them.

## Request behavior

- `POST /convert` accepts the transcript text and returns a vocalized Fusha proposal.
- `POST /chat` accepts up to eight recent user/assistant text messages and returns a short child-friendly Arabic response.
- Both routes call the Responses API with `store:false`; the server does not write message content to its logs or a database.
- The chat keeps its short context in the current page session only. Clearing it removes that context from the page.
- The app sends recognized text to the backend, not the microphone recording. The speech-recognition provider may process audio according to its own settings and policy.

## Child-safe use

A guardian should review and approve the data flow before a child uses either feature. Do not enter a child's real name, address, school, phone number, photos, or other identifying details. The chat instructions guide the model toward age-appropriate story conversation, but do not replace adult supervision or guarantee that every answer is correct. Review generated language and story content.

A successful health check only confirms that the service is configured. Verify Fusha quality, chat behavior, error handling, privacy notices, and speech playback on the target device before calling the feature ready.
