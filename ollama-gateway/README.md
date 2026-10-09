# Local task suggestions

The inbox suggestion function can use `INBOX_TASK_AI_PROVIDER=ollama`, `OLLAMA_TASK_GATEWAY_URL` and `OLLAMA_TASK_GATEWAY_KEY`. All configuration is server-side. Gemini remains the existing alternative when the provider setting is absent; Ollama requests do not fall back to Google.

The private VPS service calls only `senvia-tarefas:3b` on loopback. Create that profile from `Modelfile` after installing `qwen2.5:3b`. The 1.5B profile is not used because it missed requests and invented a deadline in evaluation.

Deploy `server.mjs`, `senvia-task-ai.service` and `install.sh` to `/home/codex/senvia-ai/gateway`, then run `install.sh` as root. It creates a root-readable random key, a restricted service and a dedicated HTTPS location in the existing `mcp.senvia.pt` host. Nginx configuration is backed up and tested before reload. Never expose Ollama's port publicly or put the gateway key in frontend environment variables.

A request is POST JSON `{sender:"CLIENTE"|"COMERCIAL",message:string}` to `/senvia-tasks/v1/classify`, with a bearer key. The endpoint cannot change the model, system prompt or destination. Request size is limited; inference is serial with up to two waiting requests and a bounded wait. Busy requests return 429 for retry. Request bodies and model output are not logged. Health requires the same key.

The model only suggests tasks. Confidence must be at least 0.85; users review and accept suggestions. A deterministic guard rejects known instruction-manipulation patterns, but is not a complete prompt-injection defense. Profile evaluation passed 8/10 synthetic cases and missed a commercial promise. No model response can execute actions.

Dates must occur in the input. The backend resolves supported explicit days in Europe/Lisbon; date-only deadlines use end of day (23:59), explicit clock times are preserved, and unsupported expressions remain unset. Existing channel/organization permissions, opt-out and the analysis ledger remain authoritative. Local analysis processes at most one unclaimed message per invocation to fit execution limits.

Rollback: remove/set a different provider setting, redeploy the previous Git version of the suggestion function, and verify. Gemini rollback also requires working provider billing; the previous configuration returned HTTP 402. The dedicated gateway service can be stopped independently; other VPS services and the base Ollama models are preserved.
