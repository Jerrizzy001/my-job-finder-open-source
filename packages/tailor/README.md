# @jobfinder/tailor

Drafts a resume and cover letter for one job from your master resume and profile, and verifies that nothing in them is new.

- `tailorDrafts(input, llm)`: with a model, a tailored pair, verified, retried once, else the untailored package; with `null`, the untailored package.
- `verifyDraft({ draft, sources })`: every name, number and date in the draft must be in the sources.
- `openAiCompatible(config)`: one `complete({ system, user, json })` for Ollama, LM Studio or OpenAI.
- `renderPdf(markdown, info)`: a PDF with the standard Helvetica fonts, no browser needed.
