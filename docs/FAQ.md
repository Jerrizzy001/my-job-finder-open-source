# FAQ

**Do I need an API key?** No. Without a model, `tailor` writes your master resume (with its skills line reordered for the job) and a templated cover letter that quotes your most relevant bullets, and says so in the manifest.

**How do I add a model?** Any OpenAI-compatible chat endpoint works. Set these in your shell (or a `.env` you source):

```bash
# Ollama: free, local. Install it, then: ollama pull llama3.1
export JOBFINDER_LLM_BASE_URL=http://127.0.0.1:11434/v1
export JOBFINDER_LLM_MODEL=llama3.1

# LM Studio
export JOBFINDER_LLM_BASE_URL=http://127.0.0.1:1234/v1

# OpenAI
export JOBFINDER_LLM_BASE_URL=https://api.openai.com/v1
export JOBFINDER_LLM_API_KEY=sk-...
export JOBFINDER_LLM_MODEL=gpt-4o-mini
```

Optional: `JOBFINDER_LLM_PRICE_INPUT_PER_M` and `JOBFINDER_LLM_PRICE_OUTPUT_PER_M` (dollars per million tokens) make `tailor` report cost as well as tokens.

**What if the model makes something up?** The verifier catches new names, numbers and dates, the draft is retried once with the problems listed, and if it still fails it is thrown away and the untailored package is written instead. The manifest's `notes` say what happened.

**Why does a SmartRecruiters board say `blocked_by_robots`?** Its API host's robots.txt currently allows only LinkedInBot, and this project honours robots.txt. See [adapters.md](adapters.md).

**Why so few matches?** Check `jobfinder boards` for failing boards, widen `roleTitles` or `locations`, or set `remoteRegions`. A student search only matches student postings, and a co-op term that ends after your `graduation` is skipped. The UI's "Why this job" and `jobfinder export --csv` show every reason.

**Where is my data?** In the folder you ran `jobfinder init` in. Delete `.jobfinder/` to start the database over; your files are untouched.

**Does it work on Windows?** It should: it is plain Node with no native modules. CI runs on Linux; reports are welcome.

**Can I use the PDFs as they are?** They use the standard Helvetica fonts so they render the same everywhere. For a designed resume, take `resume.md` into your own template.
