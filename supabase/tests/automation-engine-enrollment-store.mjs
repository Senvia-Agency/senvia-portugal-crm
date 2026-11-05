export function enrollmentStore(seed) {
  const tables = structuredClone(seed);
  const queries = [];
  let id = 0;
  return {
    tables, queries,
    from(table) {
      const predicates = [];
      let operation = 'select', payload, singular = false, limit = Infinity, sortKey, descending = false, upsertOptions;
      const field = (row, key) => key.split(/->>?/).reduce((value, part) => value?.[part], row);
      const chain = {
        select() { return chain; },
        eq(key, value) { predicates.push(row => row[key] === value); return chain; },
        ilike(key, value) { predicates.push(row => String(row[key] ?? '').toLowerCase() === value.split(String.fromCharCode(92)).join('').toLowerCase()); return chain; },
        neq(key, value) { predicates.push(row => row[key] !== value); return chain; },
        in(key, values) { predicates.push(row => values.includes(row[key])); return chain; },
        not(key, op, value) { predicates.push(row => value === null ? field(row, key) !== null && field(row, key) !== undefined : field(row, key) !== value); return chain; },
        or(expression) {
          const alternatives = expression.split(',').map(part => /^(.+)\.(is|neq)\.(.+)$/.exec(part));
          predicates.push(row => alternatives.some(match => {
            if (!match) throw new Error('Unsupported fake OR expression');
            const value = field(row, match[1]);
            return match[2] === 'is' ? match[3] === 'null' && (value === null || value === undefined) : value !== null && value !== undefined && String(value) !== match[3];
          }));
          return chain;
        },
        order(key, options) { sortKey = key; descending = options?.ascending === false; return chain; },
        limit(value) { limit = value; return chain; },
        maybeSingle() { singular = true; return chain; }, single() { singular = true; return chain; },
        insert(value) { operation = 'insert'; payload = value; return chain; },
        upsert(value, options) { operation = 'upsert'; payload = value; upsertOptions = options; return chain; },
        update(value) { operation = 'update'; payload = value; return chain; },
        then(resolve, reject) {
          queries.push({ table, operation, payload });
          try {
            const rows = tables[table] ?? (tables[table] = []);
            if (operation === 'upsert') {
              const keys = upsertOptions.onConflict.split(',');
              const existing = rows.find(row => keys.every(key => row[key] === payload[key]));
              if (existing && upsertOptions.ignoreDuplicates) return Promise.resolve({ data: singular ? null : [], error: null }).then(resolve, reject);
              const row = existing ?? { id: `generated-${++id}` };
              Object.assign(row, payload); if (!existing) rows.push(row);
              return Promise.resolve({ data: singular ? row : [row], error: null }).then(resolve, reject);
            }
            if (operation === 'insert') {
              if (table === 'automation_runs' && payload.enrollment_key && rows.some(row => row.flow_id === payload.flow_id && row.enrollment_key === payload.enrollment_key)) {
                return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate enrollment' } }).then(resolve, reject);
              }
              if (table === 'automation_runs' && payload.subject_id && rows.some(row => row.flow_id === payload.flow_id && row.subject_type === payload.subject_type && row.subject_id === payload.subject_id && ['running', 'waiting', 'awaiting_reply'].includes(row.status))) {
                return Promise.resolve({ data: null, error: { code: '23505', message: 'active run exists' } }).then(resolve, reject);
              }
              const row = { id: `generated-${++id}`, status: 'running', steps_taken: 0, ...payload };
              rows.push(row);
              return Promise.resolve({ data: singular ? row : [row], error: null }).then(resolve, reject);
            }
            const matching = rows.filter(row => predicates.every(predicate => predicate(row)));
            if (sortKey) matching.sort((a, b) => String(a[sortKey]).localeCompare(String(b[sortKey])) * (descending ? -1 : 1));
            const selected = matching.slice(0, limit);
            if (operation === 'update') selected.forEach(row => Object.assign(row, payload));
            return Promise.resolve({ data: singular ? selected[0] ?? null : selected, error: null }).then(resolve, reject);
          } catch (error) { return Promise.reject(error).then(resolve, reject); }
        },
      };
      return chain;
    },
  };
}
