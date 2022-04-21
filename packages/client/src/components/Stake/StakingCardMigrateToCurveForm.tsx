import BigNumber from "bignumber.js"
import {useState} from "react"
import {FormProvider, useForm} from "react-hook-form"
import styled from "styled-components"
import {getERC20Metadata, getMultiplier, Ticker, toDecimal} from "../../ethereum/erc20"
import useDebounce from "../../hooks/useDebounce"
import {displayNumber} from "../../utils"
import TransactionInput from "../transactionInput"

const FIDU = getERC20Metadata(Ticker.FIDU)
const USDC = getERC20Metadata(Ticker.USDC)

type StakingCardMigrateToCurveFormProps = {
  maxFiduAmountToMigrate: BigNumber
  maxUSDCAmountToDeposit: BigNumber
  fiduSharePrice: BigNumber
  migrate: (fiduAmount: BigNumber, usdcAmount: BigNumber) => Promise<any>
}

const InputContainer = styled.div`
  :not(:last-child) {
    padding-bottom: 18px;
  }
`

export default function StakingCardMigrateToCurveForm({
  maxFiduAmountToMigrate,
  maxUSDCAmountToDeposit,
  fiduSharePrice,
  migrate,
}: StakingCardMigrateToCurveFormProps) {
  const formMethods = useForm()

  const [isPending, setIsPending] = useState(false)
  const [fiduAmountToMigrate, setFiduAmountToMigrate] = useState(0)
  const [usdcAmountToDeposit, setUsdcAmountToDeposit] = useState(0)

  const debouncedSetFiduAmountToMigrate = useDebounce(setFiduAmountToMigrate, 200)
  const debouncedSetUsdcAmountToDeposit = useDebounce(setUsdcAmountToDeposit, 200)

  function onChange(ticker: Ticker.FIDU | Ticker.USDC) {
    switch (ticker) {
      case Ticker.FIDU:
        let formAmount = formMethods.getValues("fiduAmountToMigrate")
        debouncedSetFiduAmountToMigrate(formAmount)

        let otherSideAmount = getEquivalentAmountForOtherSide(new BigNumber(formAmount), ticker)
        formMethods.setValue("usdcAmountAmountToDeposit", otherSideAmount.toFixed(0))
        debouncedSetUsdcAmountToDeposit(otherSideAmount.toFixed(0))
        break
      case Ticker.USDC:
        formAmount = formMethods.getValues("usdcAmountAmountToDeposit")
        debouncedSetUsdcAmountToDeposit(formAmount)

        otherSideAmount = getEquivalentAmountForOtherSide(new BigNumber(formAmount), ticker)
        formMethods.setValue("fiduAmountToMigrate", otherSideAmount.toFixed(0))
        debouncedSetFiduAmountToMigrate(otherSideAmount.toFixed(0))
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
      new BigNumber(fiduAmountToMigrate).multipliedBy(new BigNumber(10).pow(FIDU.decimals)),
      new BigNumber(usdcAmountToDeposit).multipliedBy(new BigNumber(10).pow(USDC.decimals))
    ).then(() => setIsPending(false))
  }

  return (
    <FormProvider {...formMethods}>
      <div>
        <InputContainer>
          <div className="form-input-label">{`Amount (max: ${displayNumber(
            toDecimal(maxFiduAmountToMigrate, Ticker.FIDU)
          )}) ${FIDU.ticker}`}</div>
          <div className="form-inputs-footer">
            <TransactionInput
              name={getFormInputName(Ticker.FIDU)}
              ticker={FIDU.ticker}
              displayTicker={false}
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
          )}) ${USDC.ticker}`}</div>
          <div className="form-inputs-footer">
            <TransactionInput
              name={getFormInputName(Ticker.USDC)}
              ticker={USDC.ticker}
              displayTicker={false}
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

            <button
              type="button"
              disabled={!fiduAmountToMigrate || !usdcAmountToDeposit || isPending}
              className="button submit-form"
              onClick={onSubmit}
            >
              Migrate
            </button>
          </div>
        </InputContainer>
      </div>
    </FormProvider>
  )
}
