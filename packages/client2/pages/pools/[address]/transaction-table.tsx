import { gql } from "@apollo/client";
import { format } from "date-fns";
import Image from "next/image";
import { useCallback } from "react";

import {
  GoldfinchLogo,
  Link,
  ShimmerLines,
  Table,
} from "@/components/design-system";
import { Identicon } from "@/components/identicon";
import { formatCrypto } from "@/lib/format";
import {
  useTranchedPoolTransactionTableQuery,
  TransactionCategory,
  SupportedCrypto,
} from "@/lib/graphql/generated";
import { getShortTransactionLabel } from "@/lib/pools";
import { abbreviateAddress } from "@/lib/wallet";

gql`
  query TranchedPoolTransactionTable(
    $tranchedPoolId: String!
    $first: Int!
    $skip: Int!
  ) {
    transactions(
      where: { tranchedPool: $tranchedPoolId }
      orderBy: timestamp
      orderDirection: desc
      first: $first
      skip: $skip
    ) {
      id
      transactionHash
      user {
        id
      }
      category
      amount
      timestamp
      tranchedPool {
        id
        borrower @client {
          name
          logo
        }
      }
    }
  }
`;

interface TransactionTableProps {
  tranchedPoolId: string;
}

const subtractiveTransactionCategories = [
  TransactionCategory.TranchedPoolWithdrawal,
  TransactionCategory.TranchedPoolDrawdown,
  TransactionCategory.SeniorPoolRedemption,
];

export function TransactionTable({ tranchedPoolId }: TransactionTableProps) {
  const { data, loading, error, fetchMore } =
    useTranchedPoolTransactionTableQuery({
      variables: { tranchedPoolId, first: 20, skip: 0 },
    });

  const rows =
    data?.transactions.map((transaction) => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const borrower = transaction.tranchedPool!.borrower;

      const user =
        transaction.category === TransactionCategory.TranchedPoolDrawdown ||
        transaction.category === TransactionCategory.TranchedPoolRepayment ? (
          <div className="flex items-center gap-2">
            <div className="relative h-6 w-6 shrink-0 overflow-hidden rounded-full">
              <Image
                src={borrower.logo}
                alt=""
                layout="fill"
                objectFit="cover"
                sizes="24px"
              />
            </div>
            <span>{borrower.name}</span>
          </div>
        ) : transaction.category ===
          TransactionCategory.SeniorPoolRedemption ? (
          <div className="flex items-center gap-2">
            <GoldfinchLogo className="h-6 w-6" />
            Senior Pool
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Identicon
              account={transaction.user.id}
              className="h-6 w-6 shrink-0"
            />
            <span>{abbreviateAddress(transaction.user.id)}</span>
          </div>
        );

      const amount =
        (subtractiveTransactionCategories.includes(transaction.category)
          ? "-"
          : "+") +
        formatCrypto({
          token: SupportedCrypto.Usdc,
          amount: transaction.amount,
        });

      const date = new Date(transaction.timestamp * 1000);

      return [
        <div key={`${transaction.id}-user`}>{user}</div>,
        <div key={`${transaction.id}-category`} className="text-left">
          {getShortTransactionLabel(transaction)}
        </div>,
        <div key={`${transaction.id}-amount`}>{amount}</div>,
        <div key={`${transaction.id}-date`}>{format(date, "MMMM d, y")}</div>,
        <Link
          href={`https://etherscan.io/tx/${transaction.transactionHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sand-400"
          key={`${transaction.id}-link`}
          iconRight="ArrowTopRight"
        >
          Tx
        </Link>,
      ];
    }) ?? [];

  const onScrollBottom = useCallback(() => {
    if (data?.transactions) {
      fetchMore({
        variables: {
          skip: data?.transactions.length,
          first: 20,
        },
      });
    }
  }, [data, fetchMore]);

  return loading ? (
    <ShimmerLines lines={4} truncateFirstLine={false} />
  ) : error ? (
    <div className="text-clay-500">
      There was an error fetching transactions: {error.message}
    </div>
  ) : rows.length === 0 ? (
    <div>No recent activity</div>
  ) : (
    <Table
      headings={["User", "Category", "Amount", "Date", "Link"]}
      hideHeadings
      rows={rows}
      onScrollBottom={onScrollBottom}
    />
  );
}
