# Where the data lives

Decided 25 August 2026.

**Schools are hosted centrally.** One deployment, one Postgres, `tenant_id` on
every row. A school signs up and is running the same day; there is no machine to
install, keep switched on, back up or expose to the internet.

That is what the codebase already does, so this is a decision to keep the model
rather than change it — recorded because the alternative was seriously
considered and someone will ask why.

## The alternative, and why not

Each school running its own server, with a central directory mapping a school's
name to its address and licence, was the other candidate. It is a strong
data-protection story: pupil data never leaves the school building.

It was set aside because the cost lands on the customer. Every school would need
a machine that stays on, is backed up, and is reachable from the internet — and
when it is not, a parent at home sees nothing at all. Schools that cannot keep a
server running are exactly the schools this product is for.

## On-premise stays possible

Nothing here forecloses it. A school that insists on its own server can be given
its own instance of the same code, because a deployment is already scoped by
`tenant_id` and never assumes it is the only one. What that school would also
need — a directory entry, a licence check that works offline, and an answer for
"the school's server is down and a parent is logging in from home" — is not
built, and should not be until a school is actually paying for it.

## What follows from central hosting

- **Isolation is the product's most important property.** One database holds
  every school's fees and marks. E16-E19 and the cross-tenant fixture are not
  hygiene, they are the thing that stops one school reading another's records.
- **We are a data controller under the Kenyan Data Protection Act 2019.** Not a
  processor, not a licensor. Registration with the ODPC, a retention policy, a
  breach procedure and a lawful basis for holding children's data are all
  required, and none is done. This is on the "still not sellable" list.
- **Backups are ours to get right**, and a restore has never been rehearsed.
- **Credentials are per tenant**, never per deployment. See E20: M-Pesa
  credentials read once from environment variables at import would put every
  school's fees into one paybill.
