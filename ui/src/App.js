import React, { useState, useEffect, useRef } from 'react';
import { makeCapTP, E } from '@agoric/captp';
import { makeAsyncIterableFromNotifier as iterateNotifier } from '@agoric/notifier';
import { Far } from '@agoric/marshal';
import './styles/global.css';

import {
  activateWebSocket,
  deactivateWebSocket,
  getActiveSocket,
} from './utils/fetch-websocket.js';

import Header from './components/Header.jsx';
import CardDisplay from './components/CardDisplay.jsx';
import ApproveOfferSnackbar from './components/ApproveOfferSnackbar.jsx';
import BoughtCardSnackbar from './components/BoughtCardSnackbar.jsx';
import EnableAppDialog from './components/EnableAppDialog.jsx';

import { getCardAuctionDetail, makeBidOfferForCard } from './auction.js';
import dappConstants from './lib/constants.js';
import ModalWrapper from './components/ModalWrapper';
import ModalContent from './components/ModalContent';
import AddNewNFTForm from './components/AddNewNFTForm';

import { getSellerSeat, makeMatchingInvitation } from './swap';
import { mintNFT } from './mintNFT';

const {
  INSTANCE_BOARD_ID,
  INSTALLATION_BOARD_ID,
  // SWAP_INSTANCE_BOARD_ID,
  // CARD_MINTER_BOARD_ID,
  SWAP_WRAPPER_INSTANCE_BOARD_ID,
  MAIN_CONTRACT_BOARD_INSTANCE_ID,
  issuerBoardIds: { Card: CARD_ISSUER_BOARD_ID },
  brandBoardIds: { Money: MONEY_BRAND_BOARD_ID, Card: CARD_BRAND_BOARD_ID },
} = dappConstants;

function App() {
  const [walletConnected, setWalletConnected] = useState(false);
  const [dappApproved, setDappApproved] = useState(true);
  const [availableCards, setAvailableCards] = useState([]);
  const [cardPurse, setCardPurse] = useState(null);
  const [tokenPurses, setTokenPurses] = useState([]);
  const [openEnableAppDialog, setOpenEnableAppDialog] = useState(false);
  const [needToApproveOffer, setNeedToApproveOffer] = useState(false);
  const [boughtCard, setBoughtCard] = useState(false);
  const [activeCard, setActiveCard] = useState(null);
  const [activeCardBid, setActiveCardBid] = useState(null);
  const [tokenDisplayInfo, setTokenDisplayInfo] = useState(null);
  const [tokenPetname, setTokenPetname] = useState(null);
  const [openExpandModal, setOpenExpandModal] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [addNFTForm, setAddNFTForm] = useState(false);
  const [type, setType] = useState('Sell Product');
  const [userOffers, setUserOffers] = useState([]);
  const handleTabChange = (index) => setActiveTab(index);
  const handleDialogClose = () => setOpenEnableAppDialog(false);
  const handleAddNFTForm = () => setAddNFTForm(!addNFTForm);

  const walletPRef = useRef(undefined);
  const publicFacetRef = useRef(undefined);
  const publicFacetSwapRef = useRef(undefined);
  // const availableOfferNotifierRef = useRef(undefined);
  useEffect(() => {
    // Receive callbacks from the wallet connection.
    const otherSide = Far('otherSide', {
      needDappApproval(_dappOrigin, _suggestedDappPetname) {
        setDappApproved(false);
        setOpenEnableAppDialog(true);
      },
      dappApproved(_dappOrigin) {
        setDappApproved(true);
      },
    });

    let walletAbort;
    let walletDispatch;

    const onConnect = async () => {
      setWalletConnected(true);
      const socket = getActiveSocket();
      const {
        abort: ctpAbort,
        dispatch: ctpDispatch,
        getBootstrap,
      } = makeCapTP(
        'Card Store',
        (obj) => socket.send(JSON.stringify(obj)),
        otherSide,
      );
      walletAbort = ctpAbort;
      walletDispatch = ctpDispatch;
      const walletP = getBootstrap();
      walletPRef.current = walletP;

      const processPurses = (purses) => {
        const newTokenPurses = purses.filter(
          ({ brandBoardId }) => brandBoardId === MONEY_BRAND_BOARD_ID,
        );
        const newCardPurse = purses.find(
          ({ brandBoardId }) => brandBoardId === CARD_BRAND_BOARD_ID,
        );

        setTokenPurses(newTokenPurses);
        setTokenDisplayInfo(newTokenPurses[0].displayInfo);
        setTokenPetname(newTokenPurses[0].brandPetname);
        setCardPurse(newCardPurse);
        console.log('printing card purse:', newCardPurse);
        console.log('printing all cards:', availableCards);
      };

      async function watchPurses() {
        const pn = E(walletP).getPursesNotifier();
        for await (const purses of iterateNotifier(pn)) {
          processPurses(purses);
        }
      }
      watchPurses().catch((err) => console.error('got watchPurses err', err));

      await Promise.all([
        E(walletP).suggestInstallation('Installation', INSTALLATION_BOARD_ID),
        E(walletP).suggestInstance('Instance', INSTANCE_BOARD_ID),
        E(walletP).suggestIssuer('Card', CARD_ISSUER_BOARD_ID),
      ]);

      const zoe = E(walletP).getZoe();
      const board = E(walletP).getBoard();
      const instance = await E(board).getValue(INSTANCE_BOARD_ID);
      const publicFacet = E(zoe).getPublicFacet(instance);
      publicFacetRef.current = publicFacet;
      const swapWrapperInstance = await E(board).getValue(
        SWAP_WRAPPER_INSTANCE_BOARD_ID,
      );
      const publicFacetSwap = await E(zoe).getPublicFacet(swapWrapperInstance);
      publicFacetSwapRef.current = publicFacetSwap;

      async function watchOffers() {
        const availableOfferNotifier = await E(
          publicFacetSwapRef.current,
        ).getAvailableOfferNotifier();

        for await (const availableOffers of iterateNotifier(
          availableOfferNotifier,
        )) {
          console.log('available offers from swap:', availableOffers);
          setUserOffers(availableOffers.value || []);
        }
      }
      watchOffers().catch((err) => console.log('got watchOffer errs', err));
      /*
       *get the current items for sale in the proposal
       *Currenly these will me primary marketplace cards
       */
      const availableItemsNotifier = E(
        publicFacetRef.current,
      ).getAvailableItemsNotifier();

      // const offersSwap = await E(
      //   publicFacetSwapRef.current,
      // ).getAvailableOffers();
      // setUserOffers(offersSwap.value);
      // console.log(offersSwap, 'offers diresctly');
      /* Using the public faucet we get all the current Nfts offered for sale */
      for await (const cardsAvailableAmount of iterateNotifier(
        availableItemsNotifier,
      )) {
        console.log('available Cards:', cardsAvailableAmount);
        setAvailableCards(cardsAvailableAmount.value);
      }
    };

    const onDisconnect = () => {
      setWalletConnected(false);
      walletAbort && walletAbort();
    };

    const onMessage = (data) => {
      console.log(data);
      const obj = JSON.parse(data);
      walletDispatch && walletDispatch(obj);
    };

    activateWebSocket({
      onConnect,
      onDisconnect,
      onMessage,
    });
    return deactivateWebSocket;
  }, []);

  const handleNFTMint = ({ cardDetails }) => {
    mintNFT({
      cardDetails,
      MAIN_CONTRACT_BOARD_INSTANCE_ID,
      walletP: walletPRef.current,
      CARD_BRAND_BOARD_ID,
      cardPurse,
    });
  };

  const makeInvitationAndSellerSeat = async ({ price }) => {
    // const board = E(walletPRef.current).getBoard();
    // const swapInstallation = await E(board).getValue(SWAP_INSTANCE_BOARD_ID);
    // const publicFacet = await E(board).getValue(SWAP_PUBLIC_FAUCET_BOARD_ID);
    const params = {
      // CARD_MINTER_BOARD_ID,
      // INSTANCE_BOARD_ID,
      publicFacet: publicFacetSwapRef.current,
      sellingPrice: BigInt(price),
      // swapInstallation,
      walletP: walletPRef.current,
      cardDetail: activeCard,
    };
    const sellerSeatInvitation = await getSellerSeat(params);
    // here add functionality to store sellerSeatInvitation
    await makeMatchingInvitation({
      cardPurse,
      tokenPurses,
      cardDetail: activeCard,
      sellingPrice: BigInt(price),
      walletP: walletPRef.current,
      sellerSeatInvitation,
      publicFacet: publicFacetSwapRef.current,
    });
    // console.log('makeInvitationAndSellerSeat() result:', result);
  };
  const handleCardClick = (cardDetail, bool) => {
    console.log('active card:', cardDetail);
    setActiveCard(cardDetail);
    setOpenExpandModal(bool);
  };

  const handleCardModalClose = () => {
    setActiveCard(null);
  };
  const handleCardBidOpen = () => {
    console.log(activeCardBid);
    setActiveCardBid(true);
  };

  const handleGetCardDetail = (name) => {
    // XXX for now, everytime user call this, we will create a new invitation
    return getCardAuctionDetail({
      walletP: walletPRef.current,
      publicFacet: publicFacetRef.current,
      card: name,
    });
  };

  const submitCardOffer = (name, price, selectedPurse) => {
    return makeBidOfferForCard({
      walletP: walletPRef.current,
      publicFacet: publicFacetRef.current,
      card: name,
      cardPurse,
      tokenPurse: selectedPurse || tokenPurses[0],
      price: BigInt(price),
    }).then((result) => {
      // getSellerSession({ publicFacet: publicFacetRef.current });
      console.log('Your offer id for this current offer:', result);
      setNeedToApproveOffer(true);
    });
  };

  const handleOnClose = () => {
    setNeedToApproveOffer(false);
    setBoughtCard(false);
  };
  console.log(availableCards, 'available cards');
  return (
    <div className="App relative">
      <Header
        walletConnected={walletConnected}
        dappApproved={dappApproved}
        activeTab={activeTab}
        setActiveTab={handleTabChange}
        setType={setType}
        handleAddNFTForm={handleAddNFTForm}
      />
      <CardDisplay
        activeTab={activeTab}
        cardList={availableCards}
        cardPurse={cardPurse}
        handleClick={handleCardClick}
        userOffers={userOffers}
        type={type}
      />
      <ModalWrapper
        open={activeCard && !openExpandModal}
        onClose={handleCardModalClose}
      >
        <ModalContent
          makeSwapInvitation={makeInvitationAndSellerSeat}
          playerName={activeCard}
          type={type}
          onOpen={handleCardBidOpen}
          onClose={handleCardModalClose}
          onGetCardDetail={handleGetCardDetail}
          onBidCard={submitCardOffer}
          tokenPurses={tokenPurses}
          tokenPetname={tokenPetname}
          tokenDisplayInfo={tokenDisplayInfo}
        />
      </ModalWrapper>
      <ModalWrapper
        open={openExpandModal && activeCard}
        onClose={handleCardModalClose}
        style="modal-img"
      >
        <div className="pb-12 object-contain flex justify-center items-center">
          <img
            style={{ maxWidth: '30%' }}
            src={`https://gateway.pinata.cloud/ipfs/${activeCard?.image}`}
            alt="Card Media"
          />
        </div>
      </ModalWrapper>

      <ModalWrapper open={addNFTForm} onClose={handleAddNFTForm}>
        <h1 className="text-2xl font-semibold text-center">Add NFT</h1>
        <div className="flex flex-col gap-x-10 mt-11 mx-12 mb-12">
          <AddNewNFTForm
            tokenDisplayInfo={tokenDisplayInfo}
            handleNFTMint={handleNFTMint}
          />
        </div>
      </ModalWrapper>
      <EnableAppDialog
        open={openEnableAppDialog}
        handleClose={handleDialogClose}
      />
      <ApproveOfferSnackbar open={needToApproveOffer} onClose={handleOnClose} />
      <BoughtCardSnackbar open={boughtCard} onClose={handleOnClose} />
    </div>
  );
}

export default App;
