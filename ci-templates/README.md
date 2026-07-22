# CI templates

`ci.yml` is a ready-to-use GitHub Actions workflow that type-checks, builds, and
runs the unit tests on every push / PR to `main`.

It lives here (instead of `.github/workflows/`) because the automation token used
to push this repo lacks the `workflows` permission. To enable it, copy the file
into place and commit it from an account/token that can manage workflows:

```bash
mkdir -p .github/workflows
cp ci-templates/ci.yml .github/workflows/ci.yml
git add .github/workflows/ci.yml
git commit -m "ci: enable test workflow"
git push
```
