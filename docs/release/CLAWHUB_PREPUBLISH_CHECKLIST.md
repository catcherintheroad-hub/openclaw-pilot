# ClawHub Prepublish Checklist

- [ ] `skills/openclaw-pilot/` contains only publishable skill files
- [ ] `SKILL.md` can stand alone as the public entry page
- [ ] examples cover new project, continuation, and output contract
- [ ] `.clawhubignore` excludes local/build noise
- [ ] naming is consistent: `OpenClaw Pilot` / `openclaw-pilot`
- [ ] one-line positioning stays consistent with the beta skill shell
- [ ] public docs do not imply the skill alone provides the full native plugin/runtime path
- [ ] beta version remains beta-semantic (current recommendation: `0.3.0-beta.2`)
- [ ] `pnpm test` passes
- [ ] `pnpm build` passes
- [ ] `clawhub whoami` succeeds on the publishing machine
- [ ] publish command is reviewed before manual execution
