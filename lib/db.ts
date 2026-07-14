import { neon, type NeonQueryFunction } from '@neondatabase/serverless'

// Dual-mode database driver:
// - Neon (production / any remote DATABASE_URL): the serverless HTTP driver
// - Local Postgres (postgres://localhost…): a small adapter over `pg` that
//   mirrors the neon tagged-template API, including composable fragments
//   (sql`ORDER BY ${sql`votes DESC`}`), so localhost development never
//   touches production data.

const url = process.env.DATABASE_URL!
const isLocal = /@localhost[:/]|@127\.0\.0\.1[:/]|^postgres(?:ql)?:\/\/localhost|^postgres(?:ql)?:\/\/127\.0\.0\.1/.test(url)

type Row = Record<string, unknown>
type SqlTag = ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>) & object

function makeLocalSql(connString: string): SqlTag {
  // Lazy pool — created on first query so importing this module stays cheap
  let poolPromise: Promise<import('pg').Pool> | null = null
  function getPool() {
    poolPromise ??= import('pg').then(({ Pool }) => new Pool({ connectionString: connString }))
    return poolPromise
  }

  class LocalFragment {
    constructor(
      public strings: TemplateStringsArray,
      public values: unknown[],
    ) {}

    /** Flattens this fragment (and any nested ones) into text + params. */
    compile(params: unknown[]): string {
      let text = ''
      for (let i = 0; i < this.strings.length; i++) {
        text += this.strings[i]
        if (i < this.values.length) {
          const v = this.values[i]
          if (v instanceof LocalFragment) {
            text += v.compile(params)
          } else {
            params.push(v)
            text += `$${params.length}`
          }
        }
      }
      return text
    }

    // Awaiting a fragment executes it as a query (top-level usage)
    then<T1 = Row[], T2 = never>(
      resolve?: ((rows: Row[]) => T1 | PromiseLike<T1>) | null,
      reject?: ((err: unknown) => T2 | PromiseLike<T2>) | null,
    ): Promise<T1 | T2> {
      const params: unknown[] = []
      const text = this.compile(params)
      return getPool()
        .then(pool => pool.query(text, params))
        .then(res => res.rows as Row[])
        .then(resolve, reject)
    }
  }

  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => new LocalFragment(strings, values)
  return tag as unknown as SqlTag
}

export const sql: NeonQueryFunction<false, false> = (isLocal ? makeLocalSql(url) : neon(url)) as NeonQueryFunction<false, false>
