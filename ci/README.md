# Optional GitHub Actions validation

These YAML files are **inactive templates**. They perform validation only: no
deployment, secret provisioning, app signing, or connection to a personal runner.
The initial preparation credential could push source but could not install
workflow files, so they are kept outside `.github/workflows`.

To enable them in your own repository, use a GitHub identity with permission to
manage workflows (for a classic OAuth/PAT credential, the `workflow` scope):

```sh
mkdir -p .github/workflows
cp ci/validate.yml .github/workflows/validate.yml
cp ci/siri.yml .github/workflows/siri.yml
```

Review and commit those files. `validate.yml` runs Worker tests, local bundle
validation, distribution checks, and synthetic bootstrap/autosync checks on pushes
to main and pull requests. No Cloudflare or vault credentials are needed.

`siri.yml` is manually dispatched and needs a hosted macOS image with Xcode 27.
If unavailable, use the documented local build; do not attach an existing private
runner. Change the template and installed workflow together when maintaining CI.
