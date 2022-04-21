import BigNumber from "bignumber.js"
import {useState} from "react"
import {FormProvider, useForm} from "react-hook-form"
import styled from "styled-components"
import {getERC20Metadata, getMultiplier, Ticker, toAtomicAmount, toDecimal} from "../../ethereum/erc20"
import useDebounce from "../../hooks/useDebounce"
import {displayNumber} from "../../utils"
import TransactionInput from "../transactionInput"

const FIDU = getERC20Metadata(Ticker.FIDU)
const USDC = getERC20Metadata(Ticker.USDC)

type StakingCardMigrateToCurveFormProps = {
  // Max FIDU available to migrate (in decimals)
  maxFiduAmountToMigrate: BigNumber
  // Max USDC available to deposit (in decimals)
  maxUSDCAmountToDeposit: BigNumber
  // FIDU share price (denominated in 1e18)
  fiduSharePrice: BigNumber
  migrate: (fiduAmount: BigNumber, usdcAmount: BigNumber) => Promise<any>
}

const InputContainer = styled.div`
  :not(:last-child) {
    padding-bottom: 18px;
  }
`

const StyledButton = styled.button<{small: boolean}>`
  font-size: ${({small}) => (small ? "20px" : "inherit")};
`

export default function StakingCardMigrateToCurveForm({
  maxFiduAmountToMigrate,
  maxUSDCAmountToDeposit,
  fiduSharePrice,
  migrate,
}: StakingCardMigrateToCurveFormProps) {
  const formMethods = useForm()

  const [isPending, setIsPending] = useState(false)
  const [fiduAmountToMigrateInDecimals, setFiduAmountToMigrateInDecimals] = useState<BigNumber>(new BigNumber(0))
  const [usdcAmountToDepositInDecimals, setUsdcAmountToDepositInDecimals] = useState<BigNumber>(new BigNumber(0))

  const debouncedSetFiduAmountToMigrateInDecimals = useDebounce(setFiduAmountToMigrateInDecimals, 200)
  const debouncedSetUsdcAmountToDepositInDecimals = useDebounce(setUsdcAmountToDepositInDecimals, 200)

  function onChange(ticker: Ticker.FIDU | Ticker.USDC) {
    switch (ticker) {
      case Ticker.FIDU:
        let formAmount: string = formMethods.getValues("fiduAmountToMigrate")
        let formAmountInDecimals = !!formAmount ? new BigNumber(formAmount) : new BigNumber(0)
        debouncedSetFiduAmountToMigrateInDecimals(formAmountInDecimals)

        const usdcEquivalent = getEquivalentAmountForOtherSide(formAmountInDecimals, ticker)
        formMethods.setValue("usdcAmountAmountToDeposit", usdcEquivalent.toFixed(0))
        debouncedSetUsdcAmountToDepositInDecimals(usdcEquivalent)
        break
      case Ticker.USDC:
        formAmount = formMethods.getValues("usdcAmountAmountToDeposit")
        formAmountInDecimals = !!formAmount ? new BigNumber(formAmount) : new BigNumber(0)
        debouncedSetUsdcAmountToDepositInDecimals(formAmountInDecimals)

        const fiduEquivalent = getEquivalentAmountForOtherSide(formAmountInDecimals, ticker)
        formMethods.setValue("fiduAmountToMigrate", fiduEquivalent.toFixed(0))
        debouncedSetFiduAmountToMigrateInDecimals(fiduEquivalent)
        break
    }
  }

  function onMaxClick(ticker: Ticker.FIDU | Ticker.USDC) {
    const maxAmount = (ticker === Ticker.FIDU ? maxFiduAmountToMigrate : maxUSDCAmountToDeposit) || new BigNumber(0)
    formMethods.setValue(getFormInputName(ticker), toDecimal(maxAmount, ticker).decimalPlaces(18, 1).toString(10), {
      shouldValidate: true,
      shouldDirty: true,
    })
    onChange(ticker)
  }

  function getEquivalentAmountForOtherSide(
    currentSideAmount: BigNumber,
    currentSide: Ticker.FIDU | Ticker.USDC
  ): BigNumber {
    const exchangeRate =
      currentSide === Ticker.FIDU
        ? fiduSharePrice.div(getMultiplier(Ticker.FIDU))
        : getMultiplier(Ticker.FIDU).dividedBy(fiduSharePrice)

    return currentSideAmount.times(exchangeRate)
  }

  function getFormInputName(ticker: Ticker.FIDU | Ticker.USDC): string {
    return ticker === Ticker.FIDU ? "fiduAmountToMigrate" : "usdcAmountAmountToDeposit"
  }

  async function onSubmit(e) {
    e.preventDefault()

    setIsPending(true)
    migrate(
      toAtomicAmount(fiduAmountToMigrateInDecimals, FIDU.decimals),
      toAtomicAmount(usdcAmountToDepositInDecimals, USDC.decimals)
    ).then(() => setIsPending(false))
  }

  const hasSufficientBalance =
    maxFiduAmountToMigrate.gte(toAtomicAmount(fiduAmountToMigrateInDecimals, FIDU.decimals)) &&
    maxUSDCAmountToDeposit.gte(toAtomicAmount(usdcAmountToDepositInDecimals, USDC.decimals))

  return (
    <FormProvider {...formMethods}>
      <div>
        <InputContainer>
          <div className="form-input-label">{`Amount (max: ${displayNumber(
            toDecimal(maxFiduAmountToMigrate, Ticker.FIDU)
          )} ${FIDU.ticker})`}</div>
          <div className="form-inputs-footer">
            <TransactionInput
              name={getFormInputName(Ticker.FIDU)}
              ticker={FIDU.ticker}
              displayTicker={true}
              formMethods={formMethods}
              maxAmount={toDecimal(maxFiduAmountToMigrate, Ticker.FIDU).toString(10)}
              onChange={() => onChange(Ticker.FIDU)}
              rightDecoration={
                <button
                  className="enter-max-amount"
                  disabled={maxFiduAmountToMigrate.isZero()}
                  type="button"
                  onClick={() => onMaxClick(Ticker.FIDU)}
                >
                  Max
                </button>
              }
            />
          </div>
        </InputContainer>
        <InputContainer>
          <div className="form-input-label">{`Amount (max: ${displayNumber(
            toDecimal(maxUSDCAmountToDeposit, Ticker.USDC)
          )} ${USDC.ticker})`}</div>
          <div className="form-inputs-footer">
            <TransactionInput
              name={getFormInputName(Ticker.USDC)}
              ticker={USDC.ticker}
              displayTicker={true}
              displayUSDCTicker={true}
              formMethods={formMethods}
              maxAmount={toDecimal(maxUSDCAmountToDeposit, Ticker.USDC).toString(10)}
              onChange={() => onChange(Ticker.USDC)}
              rightDecoration={
                <button
                  className="enter-max-amount"
                  disabled={maxUSDCAmountToDeposit.isZero()}
                  type="button"
                  onClick={() => onMaxClick(Ticker.USDC)}
                >
                  Max
                </button>
              }
            />

            <StyledButton
              type="button"
              disabled={
                !hasSufficientBalance ||
                fiduAmountToMigrateInDecimals.isZero() ||
                usdcAmountToDepositInDecimals.isZero() ||
                isPending
              }
              className="button submit-form"
              onClick={onSubmit}
              small={!hasSufficientBalance}
            >
              {!hasSufficientBalance ? "Insufficient balance" : "Migrate"}
            </StyledButton>
          </div>
        </InputContainer>
      </div>
    </FormProvider>
  )
}
