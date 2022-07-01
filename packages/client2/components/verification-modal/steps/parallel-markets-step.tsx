import Image from "next/image";
import { useWizard } from "react-use-wizard";

import { Button, Link } from "@/components/design-system";

import { VerificationFlowSteps } from "../step-manifest";
import { useVerificationFlowContext } from "../verification-flow-context";
import parallelMarketsLogo from "./parallel-logo.png";
import { StepTemplate } from "./step-template";

export function ParallelMarketsStep() {
  const { entity, accredited } = useVerificationFlowContext();
  const { goToStep } = useWizard();

  return (
    <StepTemplate
      footer={
        <>
          <Button
            size="lg"
            colorScheme="secondary"
            onClick={() => goToStep(VerificationFlowSteps.IndividualOrEntity)}
            className="w-full"
          >
            Back
          </Button>
          <Button
            as="a"
            href="https://bridge.parallelmarkets.com/goldfinch"
            target="_blank"
            rel="noopener"
            className="w-full"
            iconRight="ArrowTopRight"
          >
            Verify my identity
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center">
        <Image
          src={parallelMarketsLogo}
          width={110}
          height={110}
          quality={100}
          alt="Persona"
        />

        <p className="mt-5 text-center text-sm">
          {entity === "entity" ? (
            <>
              Goldfinch uses Parallel Markets to complete verification for
              entities. After you have completed verification, we will reach out
              within 24-72 hours. If you encounter any issues, please reach out
              to{" "}
              <Link
                rel="noopener"
                href="mailto:institutional@goldfinch.finance"
              >
                institutional@goldfinch.finance
              </Link>
            </>
          ) : accredited === "accredited" ? (
            <>
              Goldfinch uses Parallel Markets to complete verification for
              accredited investors. After you have completed verification, we
              will reach out within 24-72 hours. If you encounter any issues,
              please reach out to{" "}
              <Link rel="noopener" href="mailto:accredited@goldfinch.finance">
                accredited@goldfinch.finance
              </Link>
            </>
          ) : (
            "Goldfinch uses Parallel Markets to complete identity verification."
          )}
        </p>
      </div>
    </StepTemplate>
  );
}
