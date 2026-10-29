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

## `build-linux.yml` — hardened Linux package workflow

`build-linux.yml` is an improved version of
`.github/workflows/build-linux.yml` that is currently live on `main`:

- installs `libgtk-3-dev` alongside the other native build dependencies
- adds a **verify** step that fails the job when no `.deb` is produced, or when
  the package is missing its `.desktop` entry — previously the artifact upload
  matched nothing and the job could still look green
- uploads artifacts with `if-no-files-found: warn`

The live workflow already works as-is (the `.deb` failure it used to hit was a
`package.json` metadata problem, not a workflow problem), so applying this
template is optional polish. To adopt it:

```bash
cp ci-templates/build-linux.yml .github/workflows/build-linux.yml
git add .github/workflows/build-linux.yml
git commit -m "ci(linux): verify .deb output and install gtk3 headers"
git push
```
