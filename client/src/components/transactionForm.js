import React, { useState, useContext } from 'react';
import LoadingButton from './loadingButton';
import { AppContext } from '../App.js';
import { useForm, FormProvider } from 'react-hook-form';
import { ErrorMessage } from '@hookform/error-message';
import { displayDollars } from '../utils';
import { iconX } from './icons.js';
import useCloseOnClickOrEsc from '../hooks/useCloseOnClickOrEsc';
import web3 from '../web3';

function TransactionForm(props) {
  const { erc20, pool, user, refreshUserData } = useContext(AppContext);
  const formMethods = useForm({ mode: 'onChange' });
  const [value, setValue] = useState('0');
  const [sendToAddress, setSendToAddress] = useState('');
  const [selectedValueOption, setSelectedValueOption] = useState('other');
  const [inputClass, setInputClass] = useState('');
  const [node] = useCloseOnClickOrEsc({ closeFormFn: props.closeForm, closeOnClick: false });

  function handleChange(e) {
    setValue(e.target.value);
    setSelectedValueOption('other');
    setInputClass('');
  }

  function handleSendToAddress(e) {
    setSendToAddress(e.target.value);
  }

  function handleValueOptionClick(valueOption) {
    if (valueOption.name === 'other') {
      setSelectedValueOption('other');
      setInputClass('');
    } else if (!isNaN(valueOption.value)) {
      setValue(valueOption.value);
      setSelectedValueOption(valueOption.name);
      setInputClass('pre-filled');
      formMethods.setValue('transactionAmount', valueOption.value, { shouldValidate: true, shouldDirty: true });
    }
  }

  let action = props.submitTransaction;
  let submitText = 'Submit';
  let txType = props.title;
  let buttonInfo = '';
  let register = formMethods.register;

  // With the current implementation, this will never actually be necessary
  // because the user will always already have USDC unlocked before getting
  // to this stage. However, when we add "pay with BUSD", we'll need to use
  // this, so we're accounting for it.
  // if (props.needsApproval && user.allowance && user.allowance.lte(new BN(10000))) {
  //   register = () => {};
  //   action = async () => {
  //     return sendFromUser(erc20.methods.approve(pool._address, MAX_UINT), user.address).then(result => {
  //       refreshUserData();
  //     });
  //   };
  //   submitText = 'Unlock [currency]';
  //   txType = 'Approval';
  //   buttonInfo = <div className="button-info">Step 1 of 2:</div>;
  // }

  let valueOptions;
  if (props.valueOptions) {
    const valueOptionList = props.valueOptions.map((valueOption, index) => {
      return (
        <div className="value-option" key={index}>
          <input
            name={valueOption.name}
            type="radio"
            checked={valueOption.name === selectedValueOption}
            id={`value-type-${index}`}
            onChange={() => {
              return handleValueOptionClick(valueOption);
            }}
          />
          <div className="radio-check"></div>
          <label htmlFor={`value-type-${index}`}>{valueOption.label}</label>
        </div>
      );
    });
    valueOptions = <div className="value-options">{valueOptionList}</div>;
  }

  let sendToAddressForm = '';
  const validValue = <div className="form-input-note verified-value">&#10004; valid address</div>;
  if (props.sendToAddressForm) {
    sendToAddressForm = (
      <div className="form-field">
        <div className="form-input-label">(Optional) Send to a specific address</div>
        <div className="form-input-container">
          <input
            type="string"
            onChange={e => {
              handleSendToAddress(e, props);
            }}
            name="sendToAddress"
            placeholder="0x0000"
            className="form-input small-text"
            ref={register({
              validate: value => {
                return value === '' || web3.utils.isAddress(value);
              },
            })}
          ></input>
          {sendToAddress && !formMethods.errors.sendToAddress && validValue}
          <div className="form-input-note">
            <ErrorMessage
              errors={formMethods.errors}
              name="sendToAddress"
              message="That doesn't look like a valid Ethereum address"
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={node} className={`form-full background-container ${props.formClass}`}>
      <div className="form-header">
        <div className="form-header-message">{props.headerMessage}</div>
        <div onClick={props.closeForm} className="cancel">
          Cancel{iconX}
        </div>
      </div>
      <h2>{props.title}</h2>
      <FormProvider {...formMethods}>
        <form>
          {valueOptions}
          <div className="form-inputs">
            {props.sendToAddressForm ? sendToAddressForm : ''}
            <div className="form-field">
              {props.sendToAddressForm ? <div className="form-input-label">Amount</div> : ''}
              <div className={`form-input-container dollar ${inputClass}`}>
                <input
                  name="transactionAmount"
                  type="number"
                  onChange={e => {
                    handleChange(e, props);
                  }}
                  placeholder="0"
                  className="form-input"
                  ref={register({
                    required: 'Amount is required',
                    min: { value: 0.01, message: 'Must be greater than 0' },
                    max: {
                      value: props.maxAmount,
                      message: `Amount is above the max allowed (${displayDollars(props.maxAmount)}). `,
                    },
                  })}
                ></input>
                <div className="form-input-note">
                  <ErrorMessage errors={formMethods.errors} name="transactionAmount" />
                </div>
              </div>
              {buttonInfo}
            </div>
            <LoadingButton
              action={() => {
                return action({ value, sendToAddress });
              }}
              actionComplete={props.actionComplete}
              text={submitText}
              txData={{ type: txType, amount: value }}
              sendFromUser={true}
            />
          </div>
        </form>
      </FormProvider>
    </div>
  );
}

export default TransactionForm;
