# @jobfinder/extension

Chrome MV3, loaded unpacked. Fills Ashby applications from your local jobfinder, then stops for your review.

1. `npm run build:extension` from the repo root.
2. In Chrome, open `chrome://extensions`, turn on Developer mode, choose **Load unpacked**, and pick `packages/extension/dist`.
3. Run `jobfinder serve` and paste the token it prints into the extension's **Connection** settings.
4. On an Ashby application page (`jobs.ashbyhq.com/<org>/<id>/application`) for a job in your local matches, open the extension and press **Fill this application**.

It fills what it can with confidence (including your tailored resume PDF), highlights it, lists what it left for you, and never touches Submit. CAPTCHA → "please complete and submit yourself"; sign-in → "sign in, then press Fill again"; an unknown required question → "answer in the vault, then Fill again". After you submit, Ashby's confirmation is recorded locally, or press **I submitted it**. Other ATS pages show a link to guided apply in the hosted product.
