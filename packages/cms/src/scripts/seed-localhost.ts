import payload from "payload";
import path from "path";
import { GraphQLClient, gql } from "graphql-request";
import _ from "lodash";

import { Borrower, Deal, Media } from "payload/generated-types";
import { initializePayload } from "./helpers";

const localBorrowers = [
  {
    name: "Pug Finance",
    orgType: "Fintech",
    website: "https://goldfinch.finance",
    linkedin: "https://www.linkedin.com/company/goldfinchfinance/",
    twitter: "https://twitter.com/goldfinch_fi",
    bio: "Pug Finance is a finance company that concerns itself with the ethical financing of pug loans.",
    highlights: ["Pugs are cute"],
    logoPath: path.resolve(__dirname, "pug-finance-logo.png"),
  },
  {
    name: "Pizza Loans",
    orgType: "Fintech",
    website: "https://goldfinch.finance",
    linkedin: "https://www.linkedin.com/company/goldfinchfinance/",
    twitter: "https://twitter.com/goldfinch_fi",
    bio: "Pizza Loans provides financing options for pizza lunches",
    highlights: ["Pizza is delicious", "Pizza is nutritious"],
  },
];

/**
 * Seed borrowers
 */
const insertLocalBorrowers = async () => {
  console.log(`Adding some local borrowers (${localBorrowers.length} total)`);

  await Promise.all(
    localBorrowers.map(async (borrower) => {
      try {
        const existingBorrower = await payload.find({
          collection: "borrowers",
          where: { name: { equals: borrower.name } },
        });
        if (existingBorrower.docs.length > 0) {
          console.log(
            `Skipping borrower ${borrower.name} because a borrower with this name is already in the database`
          );
          return;
        }
        console.log(`Importing borrower: ${borrower.name}`);
        let logoId: string;
        if (borrower.logoPath) {
          const thing = await payload.create({
            collection: "media",
            data: { alt: "Pug" } as Media,
            filePath: borrower.logoPath,
          });
          logoId = thing.id;
        }

        const bio: {
          [k: string]: unknown;
        }[] = [
          {
            children: [
              {
                text: borrower.bio,
              },
            ],
          },
          ...(borrower.highlights
            ? [
                {
                  children: [
                    {
                      text: "Highlights",
                    },
                  ],
                  type: "h3",
                },
                {
                  children: borrower.highlights.map((item) => ({
                    children: [
                      {
                        text: item,
                      },
                    ],
                    type: "li",
                  })),
                  type: "ul",
                },
              ]
            : []),
        ];

        return await payload.create({
          collection: "borrowers",
          data: {
            ...borrower,
            bio,
            logo: logoId,
          } as unknown as Borrower,
          filePath: borrower.logoPath,
        });
      } catch (e) {
        console.error(`Failed on: ${borrower.name}`);
        throw new Error(`Borrowers error: ${e.message}`);
      }
    })
  );

  console.log(`Done importing borrowers`);
};

/**
 * Import deals from the local chain by reading it from the local subgraph.
 * Subgraph URL is hardcoded. It makes an assumption about where the local subgraph is running
 */
const importDeals = async () => {
  const gqlClient = new GraphQLClient(
    "http://localhost:8000/subgraphs/name/goldfinch-subgraph"
  );

  try {
    const sampleQuery = gql`
      {
        _meta {
          block {
            number
          }
        }
      }
    `;
    await gqlClient.request(sampleQuery);
  } catch (e) {
    console.error(
      "Failed to import deals because the subgraph could not be reached."
    );
    console.error(e.message);
    return;
  }

  const query = gql`
    {
      loans {
        __typename
        id
        borrowerContract {
          id
        }
        termStartTime
      }
    }
  `;
  const gqlResult = await gqlClient.request(query);

  console.log(
    `Importing loans from subgraph as deals (${gqlResult.loans.length} total)`
  );

  // Keep track of deals per borrower
  const dealMapping: {
    [borrowerId: string]: string[];
  } = {};

  // Get all borrowers
  const allBorrowersRequest = await payload.find({
    collection: "borrowers",
    depth: 0,
    limit: 100,
  });

  const borrowers = allBorrowersRequest.docs;

  await Promise.all(
    gqlResult.loans.map(async (loan) => {
      const id = loan.id;
      const index = parseInt(loan.id.slice(-2), 16) % borrowers.length;
      const isDrawnDown = loan.termStartTime === "0";
      const borrower = borrowers[index];
      const deal = {
        name: _.sample([
          "Huge Money Fast",
          "Amazing Deal With Huge Yield",
          "Degen Pool #12",
          "Ape Basket",
          "Pizza Lunch",
        ]),
        category: _.sample(["NFT Loans", "Luncheon", "Prank"]),
        description:
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nunc eget mi fringilla, maximus quam sodales, condimentum arcu. Vivamus arcu lorem, ultrices at ligula ut, tempor consectetur nibh. Vivamus commodo felis eu urna facilisis, feugiat gravida lectus egestas. Suspendisse consectetur urna at ornare lacinia. Etiam erat nunc, interdum sed gravida at, condimentum in metus. Mauris at sagittis libero.",
        dealHighlights: ["Uno", "Dos", "Tres"],
        borrower: borrower.id,
      };
      if (dealMapping[borrower.id]) {
        dealMapping[borrower.id] = [...dealMapping[borrower.id], id];
      } else {
        dealMapping[borrower.id] = [id];
      }

      try {
        await payload.create({
          collection: "deals",
          depth: 0,
          data: {
            ...deal,
            id,
            overview: [{ text: deal.description }],
            details: deal.dealHighlights
              ? [
                  {
                    children: [
                      {
                        text: "Highlights",
                      },
                    ],
                    type: "h3",
                  },
                  {
                    children: deal.dealHighlights.map((item) => ({
                      children: [
                        {
                          text: item,
                        },
                      ],
                      type: "li",
                    })),
                    type: "ul",
                  },
                ]
              : null,
            borrower: borrower.id,
            dealType:
              loan.__typename === "CallableLoan"
                ? "unitranche"
                : isDrawnDown
                ? "multitranche"
                : (_.sample(["multitranche", "unitranche"]) as
                    | "multitranche"
                    | "unitranche"),
          } as unknown as Deal,
        });
      } catch (e) {
        console.log(`Error: ${(e as Error).message}`);
        console.log(`Did not import loan ${id} due to the above error`);
      }
    })
  );

  // Set borrower relation
  await Promise.all(
    Object.keys(dealMapping).map(async (borrowerId) => {
      return await payload.update({
        id: borrowerId,
        collection: "borrowers",
        depth: 0,
        data: {
          deals: dealMapping[borrowerId],
        },
      });
    })
  );

  console.log(`Done importing deals`);
};

const main = async () => {
  await initializePayload();
  await insertLocalBorrowers();
  await importDeals();

  process.exit(0);
};

main();
