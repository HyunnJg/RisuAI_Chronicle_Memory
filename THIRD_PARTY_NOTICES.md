# Third-party notices

## Chronicle Memory

Copyright (C) 2026 HyunnJg.

Unless otherwise identified below, the source code, build scripts, tests and generated Chronicle plugin/module code are licensed under GNU GPL version 3 only (SPDX: GPL-3.0-only). See LICENSE. The software is provided without warranty.

## RPack mapping for RisuAI module compatibility

- Included file: `rpack_map.bin` (512 bytes).
- Origin: [kwaroran/RisuAI, src/ts/rpack](https://github.com/kwaroran/RisuAI/tree/ea61945f9038e0189807d075f55f4e66ab7e98bf/src/ts/rpack).
- Upstream commit: `ea61945f9038e0189807d075f55f4e66ab7e98bf`.
- Upstream blob: `18e10e23907af0b8b15f26aae1cffc4cc4d269f5`.
- Copyright (c) 2026 Kwaroran.
- Upstream's license selection notice is reproduced unchanged in `RPACK_UPSTREAM_LICENSE.txt`.
- The MIT license text is reproduced in `RPACK_LICENSE.txt`.

Upstream permits the MIT option when RPack is used only within RisuAI and requires AGPL-3.0 for other applications or embedding RisuAI inside another application. This distribution uses the mapping only to generate modules for RisuAI and selects that MIT option. No upstream RPack JavaScript implementation is bundled. This notice does not remove or broaden upstream's terms. Reusing the mapping in another application requires reviewing those terms independently of Chronicle's GPL license.

## Referenced host API

RisuAI itself is licensed under GPL-3.0. It is not bundled with this plugin. Its API documentation and module format were consulted for compatibility; this project is not an official RisuAI release. The reviewed host revision is the commit listed above.
