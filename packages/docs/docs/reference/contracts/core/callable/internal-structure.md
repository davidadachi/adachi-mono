# General documentation
General documentation can be found in the community docs
[https://docs.goldfinch.finance/] Hosted app URL
[https://github.com/goldfinch-eng/community-docs] Public repo URL

# Checkpointing
Checkpointing makes a snapshot of time-dependent accounting variables. The snapshot includes:
- Checkpoint time
- Accrued interest
- Owed interest

This is important for keeping track of interest bearing balance, and tracking the accrual of interest when the interest-bearing balance can change.

Checkpointing also settles reserved principal if a principal payment due date has passed since the last time a checkpoint occurred. Settling reserved principal converts the reserved principal into principal paid.

# Interest bearing balance
See the general documentation on Interest bearing balance for general business logic.

In the implementation, we account for interest bearing balance by keeping track of paid principal in two places, each tranche's `principalPaid` and each tranche's `principalReserved`.

In order to determine interest bearing balance, start by summing `principalPaid` across all tranches.

Then add `principalReserved` summed across all the tranches if a principal payment due date has passed since the last time a checkpoint occurred.



# Relationship between tranches, PaymentSchedule principal periods, and Call Request Periods

Tranches, PaymentSchedule principal periods, and Call Request Periods are all directly related to one another.
Usually, these terms refer to different features of the same entity.

### Tranches

A tranche describes a grouping of lender's capital. It contains accounting variables to track how much interest + principal have been paid to the tranche, and how much principal has been deposited in the tranche.

- In general finance terms, a tranche usually refers to a grouping of capital which sits in relative priority to other tranches (other groupings of capital)
- In callable loans, a tranche either corresponds to a call request period or uncalled capital.
  - Call request periods have sequential priority depending on when they start and end (no overlap). Earlier call request periods have priority over later ones.
  - All call requested capital has priority over uncalled capital.

### PaymentSchedule Principal Periods

A PaymentSchedule principalPeriod is a configurable block of time.

- Principal periods are contiguous and sequential.
- Principal periods can be non-uniform (i.e. calendar months)
- PaymentSchedules are more generally used to track dates of interest in various Goldfinch loans (even non callable loans)

### Call Request Periods

A Call Request period refers to a block of time during which lenders can submit call requests to call back their capital. In our current scheme, call request period time boundaries are defined by PaymentSchedule principal periods.

Of n tranches, Tranche #0 to Tranche #n-1 are call request period tranches. The last tranche is an uncalled capital tranche. So there is 1 less call request period than there are tranches.

### A diagram

In the diagram below, imagine a loan where the first drawdown occurs in February.
The Schedule's stub period is the rest of February, and the first principal period is from the drawdown to the end of May.

                          +- Stub Period
                          v
                        +---+-----------------------+---------------------------+
    principal periods   |///|     0     |     1     |     2     |     3     |
                        |---+-----------+-----------+-----------+-----------+ E
    Tranche index       |///|     0     |     1     |     2     |    ***    | N
                        +---+---+---+---+---+---+---+---+---+---+---+---+---+ D
    Call request period |///|     0     |     1     |     2     |\\\\\\\\\\\|
    periods             +---+---+---+---+---+---+---+---+---+---+---+---+---+---+
    PaymentSchedule     |FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|JAN|FEB|MAR|
    Periods             |///| 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10| 11| 12|
                        +---+---+---+---+---+---+---+---+---+---+---+---+---+
    absolute             ...| 25| 26| 27| 28| 29| 30| 31| 32| 33| 34| 35| 36| 37
    periods             +---+---+---+---+---+---+---+---+---+---+---+---+---+

\*\*\* Tranche index 3 exists, but it refers to uncalled capital.
There is no call request period 3 since that capital would be due & have the same priority as uncalled capital.
