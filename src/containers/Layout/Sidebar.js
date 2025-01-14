import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import styled from 'styled-components';
import { compose } from 'recompose';
import { NavLink, withRouter } from 'react-router-dom';
import { bindActionCreators } from 'redux';
import { Select } from 'antd';
import BigNumber from 'bignumber.js';
import {
  getTokenContract,
  getVbepContract,
  getComptrollerContract,
  getVaiTokenContract,
  methods
} from 'utilities/ContractService';
import { promisify } from 'utilities';
import * as constants from 'utilities/constants';
import ConnectModal from 'components/Basic/ConnectModal';
import { Label } from 'components/Basic/Label';
import Button from '@material-ui/core/Button';
import { connectAccount, accountActionCreators } from 'core';
import MetaMaskClass from 'utilities/MetaMask';
import logoImg from 'assets/img/logo.png';
import commaNumber from 'comma-number';
import { checkIsValidNetwork, getBigNumber } from 'utilities/common';
import toast from 'components/Basic/Toast';

const SidebarWrapper = styled.div`
  background-color: var(--color-bg-primary);
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 10px;

  @media only screen and (max-width: 768px) {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    margin-right: 0px;
  }
`;

const Logo = styled.div`
  display: flex;
  justify-content: start;
  align-items: center;
  flex-grow: 1;

  i {
    font-size: 18px;
  }

  @media only screen and (max-width: 768px) {
    padding: 0 20px;
    img {
      width: 60px;
    }
  }

  @media only screen and (max-width: 1280px) {
    i {
      font-size: 12px !important;
    }
    img {
      width: 80px !important;
    }
  }
`;

const TotalValue = styled.div`
  padding: 0 30px;
  flex-shrink: 0;

  > div {
    span:first-child {
      word-break: break-all;
      text-align: center;
    }
  }

  @media only screen and (max-width: 768px) {
    display: none;
  }
`;

const MobileMenu = styled.div`
  display: none;

  @media only screen and (max-width: 768px) {
    display: block;
    position: relative;
    .ant-select {
      .ant-select-selection {
        background-color: transparent;
        border: none;
        color: var(--color-text-main);
        font-size: 17px;
        font-weight: 900;
        color: var(--color-text-main);
        margin-top: 4px;
        i {
          color: var(--color-text-main);
        }
      }
    }
  }
`;

const ConnectButton = styled.div`
  display: flex;
  justify-content: center;
  margin-left: 30px;

  @media only screen and (max-width: 768px) {
    margin: 0;
  }

  .connect-btn {
    height: 30px;
    border-radius: 5px;
    background-image: linear-gradient(to right, #f2c265, #f7b44f);

    .MuiButton-label {
      font-size: 13px;
      font-weight: 500;
      color: var(--color-text-main);
      text-transform: capitalize;

      @media only screen and (max-width: 768px) {
        font-size: 12px;
      }
    }
  }
`;

const { Option } = Select;

let metamask = null;
let accounts = [];
let metamaskWatcher = null;
let walletType = null;
const abortController = new AbortController();

const format = commaNumber.bindWith(',', '.');

function Sidebar({ history, settings, setSetting, getGovernanceVenus }) {
  const [isOpenModal, setIsOpenModal] = useState(false);
  const [isMarketInfoUpdating, setMarketInfoUpdating] = useState(false);
  const [error, setError] = useState('');
  const [web3, setWeb3] = useState(null);
  const [awaiting, setAwaiting] = useState(false);
  const [totalVaiMinted, setTotalVaiMinted] = useState('0');
  const [tvl, setTVL] = useState(new BigNumber(0));
  const [wcUri, setWcUri] = useState(null);

  const defaultPath = history.location.pathname.split('/')[1];

  useEffect(() => {
    if (settings.walletType) {
      walletType = settings.walletType;
    }
  }, [settings.walletType]);

  const checkNetwork = () => {
    let netId;
    if (window.BinanceChain && settings.walletType === 'binance') {
      netId = +window.BinanceChain.chainId;
    } else {
      netId = window.ethereum.networkVersion
        ? +window.ethereum.networkVersion
        : +window.ethereum.chainId;
    }
    if (netId) {
      if (netId === 97 || netId === 56) {
        if (netId === 97 && process.env.REACT_APP_ENV === 'prod') {
          toast.error({
            title: `You are currently visiting the Binance Testnet Smart Chain Network. Please change your metamask to access the Binance Smart Chain Main Network`
          });
        } else if (netId === 56 && process.env.REACT_APP_ENV === 'dev') {
          toast.error({
            title: `You are currently visiting the Binance Smart Chain Main Network. Please change your metamask to access the Binance Testnet Smart Chain Network`
          });
        } else {
          setSetting({
            wrongNetwork: false
          });
          return;
        }
      } else {
        toast.error({
          title: `Venus is only supported on Binance Smart Chain Network. Please confirm you installed Metamask and selected Binance Smart Chain Network`
        });
      }
      setSetting({
        wrongNetwork: true
      });
    }
  };

  useEffect(() => {
    if (window.ethereum || window.BinanceChain) {
      window.addEventListener('load', () => {
        checkNetwork();
      });
    }
  }, [window.ethereum, window.BinanceChain]);

  // ---------------------------------MetaMask connect-------------------------------------
  const withTimeoutRejection = async (promise, timeout) => {
    const sleep = new Promise((resolve, reject) =>
      setTimeout(() => reject(new Error(constants.TIMEOUT)), timeout)
    );
    return Promise.race([promise, sleep]);
  };

  const handleWatch = useCallback(async () => {
    if (!walletType) return;
    if (window.ethereum) {
      const accs = await window.ethereum.request({ method: 'eth_accounts' });
      if (!accs[0]) {
        accounts = [];
        clearTimeout(metamaskWatcher);
        setSetting({ selectedAddress: null });
      }
    }
    if (metamaskWatcher) {
      clearTimeout(metamaskWatcher);
    }

    if (!web3 || !accounts.length) {
      setAwaiting(true);
    }

    try {
      const isLocked = error && error.message === constants.LOCKED;
      if (!metamask || isLocked) {
        metamask = await withTimeoutRejection(
          MetaMaskClass.initialize(undefined, walletType), // if option is existed, add it
          20 * 1000 // timeout
        );
      }
      const [tempWeb3, tempAccounts, latestBlockNumber] = await Promise.all([
        metamask.getWeb3(),
        metamask.getAccounts(walletType),
        metamask.getLatestBlockNumber()
      ]);
      accounts = tempAccounts;
      setWeb3(tempWeb3);
      setError(null);
      setAwaiting(false);
      setSetting({
        selectedAddress: tempAccounts[0],
        latestBlockNumber
      });
      metamaskWatcher = setTimeout(() => {
        clearTimeout(metamaskWatcher);
        handleWatch();
      }, 3000);
    } catch (err) {
      setSetting({ selectedAddress: null });
      accounts = [];
      setWeb3(null);
      setError(err);
      setAwaiting(false);
    }
  }, [error, web3]);

  const handleMetaMask = () => {
    if (window.ethereum) {
      setSetting({ walletType: 'metamask' });
      setError(
        MetaMaskClass.hasWeb3() ? '' : new Error(constants.NOT_INSTALLED)
      );
      handleWatch();
    }
  };
  // -------------------------------------------------------------------------------------
  // --------------------Binance Wallet Connect---------------------------------
  const handleBinance = () => {
    if (window.BinanceChain) {
      setSetting({ walletType: 'binance' });
      setError(
        MetaMaskClass.hasWeb3() ? '' : new Error(constants.NOT_INSTALLED)
      );
      handleWatch();
    }
  };
  const setDecimals = async () => {
    const decimals = {};
    Object.values(constants.CONTRACT_TOKEN_ADDRESS).forEach(async item => {
      decimals[`${item.id}`] = {};
      if (item.id !== 'bnb') {
        const tokenContract = getTokenContract(item.id);
        const tokenDecimals = await methods.call(
          tokenContract.methods.decimals,
          []
        );
        const vBepContract = getVbepContract(item.id);
        const vtokenDecimals = await methods.call(
          vBepContract.methods.decimals,
          []
        );
        decimals[`${item.id}`].token = Number(tokenDecimals);
        decimals[`${item.id}`].vtoken = Number(vtokenDecimals);
        decimals[`${item.id}`].price = 18 + 18 - Number(tokenDecimals);
      } else {
        decimals[`${item.id}`].token = 18;
        decimals[`${item.id}`].vtoken = 8;
        decimals[`${item.id}`].price = 18;
      }
    });
    setSetting({ decimals });
  };

  const initSettings = async () => {
    await setDecimals();
    setSetting({
      pendingInfo: {
        type: '',
        status: false,
        amount: 0,
        symbol: ''
      }
    });
  };

  useEffect(() => {
    if (accounts.length !== 0) {
      setIsOpenModal(false);
    }
    return function cleanup() {
      abortController.abort();
    };
  }, [handleWatch, settings.selectedAddress]);

  useEffect(() => {
    handleWatch();
  }, [window, history]);

  const getTotalVaiMinted = async () => {
    // total vai minted
    const vaiContract = getVaiTokenContract();
    let tvm = await methods.call(vaiContract.methods.totalSupply, []);
    tvm = new BigNumber(tvm).div(new BigNumber(10).pow(18));
    setTotalVaiMinted(tvm);
  };

  const getMarkets = async () => {
    const res = await promisify(getGovernanceVenus, {});
    if (!res.status) {
      return;
    }

    const markets = Object.keys(constants.CONTRACT_VBEP_ADDRESS)
      .map(item =>
        res.data.markets.find(
          market => market.underlyingSymbol.toLowerCase() === item.toLowerCase()
        )
      )
      .filter(item => !!item);
    setSetting({
      markets,
      dailyVenus: res.data.dailyVenus
    });
  };

  useEffect(() => {
    let updateTimer;
    if (settings.selectedAddress) {
      updateTimer = setInterval(() => {
        if (checkIsValidNetwork(settings.walletType)) {
          getMarkets();
        }
      }, 5000);
    }
    return function cleanup() {
      abortController.abort();
      if (updateTimer) {
        clearInterval(updateTimer);
      }
    };
  }, [settings.selectedAddress, settings.accountLoading]);

  const onChangePage = value => {
    history.push(`/${value}`);
  };

  useEffect(() => {
    if (checkIsValidNetwork(settings.walletType)) {
      getTotalVaiMinted();
    }
  }, [settings.markets]);

  useEffect(() => {
    if (window.ethereum || window.BinanceChain) {
      if (
        !settings.accountLoading &&
        checkIsValidNetwork(settings.walletType)
      ) {
        initSettings();
      }
    }
    return function cleanup() {
      abortController.abort();
    };
  }, [settings.accountLoading]);

  useEffect(() => {
    if (!settings.selectedAddress || !walletType) {
      return;
    }
    if (
      window.ethereum &&
      settings.walletType !== 'binance' &&
      checkIsValidNetwork(settings.walletType)
    ) {
      window.ethereum.on('accountsChanged', accs => {
        setSetting({
          selectedAddress: accs[0],
          accountLoading: true
        });
      });
    } else if (
      window.BinanceChain &&
      settings.walletType === 'binance' &&
      checkIsValidNetwork(settings.walletType)
    ) {
      window.BinanceChain.on('accountsChanged', accs => {
        setSetting({
          selectedAddress: accs[0],
          accountLoading: true
        });
      });
    }
  }, [window.ethereum, window.BinanceChain, settings.selectedAddress]);

  const updateMarketInfo = async () => {
    const accountAddress = settings.selectedAddress;
    if (
      !accountAddress ||
      !settings.decimals ||
      !settings.markets ||
      isMarketInfoUpdating
    ) {
      return;
    }
    const appContract = getComptrollerContract();
    const vaiContract = getVaiTokenContract();

    setMarketInfoUpdating(true);

    try {
      let [vaultVaiStaked, venusVAIVaultRate] = await Promise.all([
        methods.call(vaiContract.methods.balanceOf, [
          constants.CONTRACT_VAI_VAULT_ADDRESS
        ]),
        methods.call(appContract.methods.venusVAIVaultRate, [])
      ]);
      // Total Vai Staked
      vaultVaiStaked = new BigNumber(vaultVaiStaked).div(1e18);

      // venus vai vault rate
      venusVAIVaultRate = new BigNumber(venusVAIVaultRate)
        .div(1e18)
        .times(20 * 60 * 24);

      // VAI APY
      const xvsMarket = settings.markets.find(
        ele => ele.underlyingSymbol === 'XVS'
      );
      const vaiAPY = new BigNumber(venusVAIVaultRate)
        .times(xvsMarket.tokenPrice)
        .times(365 * 100)
        .div(vaultVaiStaked)
        .dp(2, 1)
        .toString(10);

      const totalLiquidity = (settings.markets || []).reduce(
        (accumulator, market) => {
          return new BigNumber(accumulator).plus(
            new BigNumber(market.totalSupplyUsd)
          );
        },
        vaultVaiStaked
      );
      setSetting({
        vaiAPY,
        vaultVaiStaked
      });

      setTVL(totalLiquidity);
      setMarketInfoUpdating(false);
    } catch (error) {
      console.log(error);
      setMarketInfoUpdating(false);
    }
  };

  const handleAccountChange = async () => {
    await updateMarketInfo();
    setSetting({
      accountLoading: false
    });
  };

  useEffect(() => {
    updateMarketInfo();
  }, [settings.markets]);

  useEffect(() => {
    if (!settings.selectedAddress) return;
    handleAccountChange();
  }, [settings.selectedAddress]);
  return (
    <SidebarWrapper>
      <Logo>
        <NavLink to="/" activeClassName="active">
          <img src={logoImg} alt="logo" className="logo-text" />
        </NavLink>
      </Logo>
      {settings.selectedAddress && (
        <TotalValue>
          <div className="flex flex-column align-center just-center">
            <Label primary>
              ${format(new BigNumber(tvl).dp(2, 1).toString(10))}
            </Label>
            <Label className="center">Total Value Locked</Label>
          </div>
        </TotalValue>
      )}
      {settings.selectedAddress && (
        <TotalValue>
          <div className="flex flex-column align-center just-center">
            <Label primary>
              {format(
                getBigNumber(totalVaiMinted)
                  .dp(0, 1)
                  .toString(10)
              )}
            </Label>
            <Label className="center">Total VAI Minted</Label>
          </div>
        </TotalValue>
      )}
      <ConnectButton>
        <Button
          className="connect-btn"
          onClick={() => {
            setIsOpenModal(true);
          }}
        >
          {!settings.selectedAddress
            ? 'Connect'
            : `${settings.selectedAddress.substr(
                0,
                6
              )}...${settings.selectedAddress.substr(
                settings.selectedAddress.length - 4,
                4
              )}`}
        </Button>
      </ConnectButton>
      <MobileMenu id="main-menu">
        <Select
          defaultValue={defaultPath}
          style={{ width: 120, marginRight: 10 }}
          getPopupContainer={() => document.getElementById('main-menu')}
          dropdownMenuStyle={{
            backgroundColor: '#090d27'
          }}
          dropdownClassName="asset-select"
          onChange={onChangePage}
        >
          <Option className="flex align-center just-center" value="dashboard">
            <Label size={14} primary>
              Dashboard
            </Label>
          </Option>
          {process.env.REACT_APP_ENV === 'dev' && (
            <Option className="flex align-center just-center" value="faucet">
              <Label size={14} primary>
                Faucet
              </Label>
            </Option>
          )}
        </Select>
      </MobileMenu>
      <ConnectModal
        visible={isOpenModal}
        web3={web3}
        error={error}
        wcUri={wcUri}
        awaiting={awaiting}
        walletType={walletType}
        onCancel={() => setIsOpenModal(false)}
        onConnectMetaMask={handleMetaMask}
        onConnectBinance={handleBinance}
        onBack={() => setWcUri(null)}
      />
    </SidebarWrapper>
  );
}

Sidebar.propTypes = {
  history: PropTypes.object,
  settings: PropTypes.object,
  setSetting: PropTypes.func.isRequired,
  getGovernanceVenus: PropTypes.func.isRequired
};

Sidebar.defaultProps = {
  settings: {},
  history: {}
};

const mapStateToProps = ({ account }) => ({
  settings: account.setting
});

const mapDispatchToProps = dispatch => {
  const { setSetting, getGovernanceVenus } = accountActionCreators;

  return bindActionCreators(
    {
      setSetting,
      getGovernanceVenus
    },
    dispatch
  );
};

export default compose(
  withRouter,
  connectAccount(mapStateToProps, mapDispatchToProps)
)(Sidebar);
