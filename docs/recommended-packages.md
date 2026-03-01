# Recommended Packages

When you need to add a dependency, **check this list first**. These are curated, well-maintained packages that fit common needs. Prefer a recommended package when it covers your use case.

## How to use this list

- **Agents:** Before running `npm install` or `pnpm add` for a new capability, check if a recommended package fits.
- If a recommended package covers the need, use it over alternatives.
- If no recommended package fits, you may add other packages but note the choice (e.g. in a PR or task note).

## Table

| Category      | Package     | npm name                | When to use it                                                                              |
| ------------- | ----------- | ----------------------- | ------------------------------------------------------------------------------------------- |
| Validation    | Zod         | `zod`                   | Schema declaration and validation; use for all input/output validation at boundaries.       |
| Data fetching | React Query | `@tanstack/react-query` | Server state management; use for any API data fetching in React.                            |
| Utilities     | Lodash      | `lodash-es`             | Collection/object manipulation; prefer lodash-es for tree-shaking.                          |
| Identifiers   | UUID        | `uuid`                  | RFC-compliant UUID generation when you need unique IDs.                                     |
| Authorization | CASL        | `@casl/ability`         | Isomorphic authorization; use for permission/access control logic.                          |
| Pattern match | ts-pattern  | `ts-pattern`            | Exhaustive pattern matching; use instead of long switch/if chains for discriminated unions. |
| SQL           | Knex        | `knex`                  | SQL query builder; use when an ORM is too heavy.                                            |
| Database      | Dolt        | `dolt`                  | Version-controlled MySQL-compatible database (used by TaskGraph).                           |
| API contracts | ts-rest     | `@ts-rest/core`         | Type-safe REST contracts; use for defining and consuming REST APIs.                         |
| Visualization | React Flow  | `@xyflow/react`         | Node-based UIs; use for flowcharts, diagrams, graph editors.                                |
| Data grid     | AG Grid     | `ag-grid-react`         | Enterprise data grid; use for complex tables with sorting/filtering.                        |
| Dates         | date-fns    | `date-fns`              | Date utilities; use instead of moment.js for date manipulation.                             |
| Email         | MJML        | `mjml`                  | Responsive email framework; use for building HTML emails.                                   |

## Contributing

To add a package to this list: ensure it is well-maintained, widely used, and fits a clear category. Add one line in the table and a short "when to use it" description.
