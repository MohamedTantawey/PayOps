import { execFileSync } from 'node:child_process';
execFileSync('npx', ['prisma', 'db', 'push'], { stdio: 'inherit' });
execFileSync('npx', ['prisma', 'db', 'execute', '--file', 'prisma/sql/ledger-constraints.sql', '--schema', 'prisma/schema.prisma'], { stdio: 'inherit' });
