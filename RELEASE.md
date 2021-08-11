
# Release procedure

- Update version number in `package.json`
- Update the [changelog](CHANGELOG.md)
- Merge changes to upstream master branch.
- Package and manually test the plugin (package using `vsce package`)
- Tag the commit with the version number (i.e. `v1.2.3`)
- Publish the release (`vsce publish`), see https://code.visualstudio.com/api/working-with-extensions/publishing-extension
