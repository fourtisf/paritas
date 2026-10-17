// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Session} from "./libraries/Types.sol";
import {SessionLib} from "./libraries/SessionLib.sol";

/// @notice The on-chain market clock. Weekday schedule is fixed in SessionLib; market holidays and
/// early closes are set by governance (timelock) ahead of time, from config/holidays.json.
contract SessionController is Ownable {
    /// @dev keyed by New York local day index (SessionLib.toNewYork)
    mapping(uint256 day => bool) public isHoliday;
    mapping(uint256 day => bool) public isEarlyClose;

    event HolidaySet(uint256 indexed day, bool on);
    event EarlyCloseSet(uint256 indexed day, bool on);

    constructor(address owner_) Ownable(owner_) {}

    function setHolidays(uint256[] calldata daysList, bool on) external onlyOwner {
        for (uint256 i; i < daysList.length; ++i) {
            isHoliday[daysList[i]] = on;
            emit HolidaySet(daysList[i], on);
        }
    }

    function setEarlyCloses(uint256[] calldata daysList, bool on) external onlyOwner {
        for (uint256 i; i < daysList.length; ++i) {
            isEarlyClose[daysList[i]] = on;
            emit EarlyCloseSet(daysList[i], on);
        }
    }

    function current() external view returns (Session) {
        return sessionAt(block.timestamp);
    }

    function isTradingDay(uint256 day) public view returns (bool) {
        uint256 wd = SessionLib.weekday(day);
        return wd >= 1 && wd <= 5 && !isHoliday[day];
    }

    /// @dev Rules (New York time):
    ///  trading day: 00:00-04:00 Overnight, 04:00-09:30 Extended, 09:30-16:00 Regular (13:00 early close),
    ///               then Extended until 20:00, then Overnight if tomorrow trades, else Closed.
    ///  other days:  Closed, except from 20:00 when tomorrow trades (Sunday evening) -> Overnight.
    function sessionAt(uint256 ts) public view returns (Session) {
        (uint256 day, uint256 minute) = SessionLib.toNewYork(ts);
        bool nextTrades = isTradingDay(day + 1);
        if (!isTradingDay(day)) {
            return (minute >= SessionLib.POST_CLOSE && nextTrades) ? Session.Overnight : Session.Closed;
        }
        if (minute < SessionLib.PRE_OPEN) return Session.Overnight;
        if (minute < SessionLib.OPEN) return Session.Extended;
        uint256 close = isEarlyClose[day] ? SessionLib.EARLY_CLOSE : SessionLib.CLOSE;
        if (minute < close) return Session.Regular;
        if (minute < SessionLib.POST_CLOSE) return Session.Extended;
        return nextTrades ? Session.Overnight : Session.Closed;
    }
}
