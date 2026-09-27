# {{project.name}}

TODO(acc-adapt) : décrire le projet.

<!-- acc:begin agent-workflows -->
## Flux de travail

{{#if commands.test}}
- Tests : `{{commands.test}}`
{{/if}}
{{#each hooks.preCommit}}
- Hook {{this.name}} : `{{this.command}}`
{{/each}}
<!-- acc:end agent-workflows -->

<!-- acc:begin agent-rules -->
## Règles

- Branche principale : {{git.mainBranch}}
<!-- acc:end agent-rules -->
