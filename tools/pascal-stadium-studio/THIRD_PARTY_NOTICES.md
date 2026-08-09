# Third-party notices

This development tool integrates with the Pascal Editor source repository at
commit `99cc537e2538419536be86678a6139047a13af9d` and exact published packages
`@pascal-app/core@0.9.2`, `@pascal-app/viewer@0.9.2`, and
`@pascal-app/editor@0.9.2`.

Pascal Editor is MIT licensed, copyright (c) 2026 Pascal Group Inc. The full
MIT notice is reproduced in [LICENSE](./LICENSE). The bootstrap keeps the
upstream checkout's own `LICENSE` unchanged.

The integration pattern follows the official Pascal Nature example. The pinned
host lock uses `pascalorg/plugin-trees` commit
`56d978cd9b409b716207b3f3d269455d3cd6f067` (the separately researched current
`main` head was `f054f889eabbba684003938d7f7142f8cd15e558`). No Nature assets or procedural
tree code are copied into this package. That repository is MIT licensed,
copyright (c) 2026 Pascal.
