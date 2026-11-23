# Arabic Fusha conversion service

The app can send the recognized transcript text (not the audio recording from the Convert button) to this service and review the returned proposal before saving a story.

## Railway deployment

- Repository: `shady981981-hub/qissati-bisoora-apk`
- Service root directory: `/backend`
- Deploy branch: `development/voice-fusha-conversion` until the backend files land on `main`
- Start command: `npm start`
- Health check: `/health`
- Public conversion route: `/convert`

The production domain is configured in `index.html` as `FUSHA_CONVERSION_ENDPOINT`. Update it there if the service domain changes, then rebuild the APK.

Set `OPENAI_API_KEY` as a Railway secret, never in the APK or GitHub. The service returns `503` until this secret exists. Optionally set `OPENAI_MODEL`. Never expose secrets in logs or commit them.

## Child privacy and safe use

The initial speech-to-text step uses Android or browser speech recognition; that provider may process audio according to its own policy, which must be reviewed separately. Pressing Convert sends the text shown in the editor to this backend; the backend sends that text to the model API with `store:false`. Do not enter a child's name, address, school, or other identifying information.

Before enabling conversion for children, the guardian must review and approve the data flow and applicable privacy notice. Keep access limits and abuse protection enabled. The returned text is only a proposal: the app requires a checked guardian-consent acknowledgement and manual text review before the text is used to create a story. This checkbox does not authenticate the guardian or complete a privacy review; the app owner must still approve the data flow and applicable notice before enabling the service for children. A successful health check alone does not mean conversion is configured; verify `/health` returns `configured:true`, then test Arabic MSA, diacritics, error handling, and the resulting speech on target devices.
