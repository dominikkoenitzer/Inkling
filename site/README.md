# Download page

The page behind https://get-inkling.vercel.app: plain static files, no build step.
It names no author and does not link to this repository.

- `index.html` is the page.
- `vercel.json` holds the download addresses, each a temporary redirect:
  - `/download/windows`: the newest release's `Inkling-Setup.exe`
  - `/download/mac`: the newest release's `Inkling-mac.dmg`
  - `/download/linux`: the newest release's `Inkling.AppImage`
  - `/update/latest.yml`: the newest release's `latest.yml`
  - `/update/latest-mac.yml`: the newest release's `latest-mac.yml`
  - `/update/latest-linux.yml`: the newest release's `latest-linux.yml`
  - `/update/:file`: the newest release's `:file`
- `llms.txt` describes Inkling for AI assistants.
- `skill/inkling/` is the assistant skill, and `skill/inkling.zip` is that folder zipped. Rebuild the zip after an edit, from this folder:

  ```
  python -c "import shutil; shutil.make_archive('skill/inkling', 'zip', 'skill', 'inkling')"
  ```

Vercel deploys this folder whenever a push to main changes it. `.vercelignore` keeps this README off the site.
