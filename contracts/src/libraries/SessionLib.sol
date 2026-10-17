// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

/// @notice New York local time on-chain, with US daylight saving rules
/// (DST from the second Sunday of March 02:00 local to the first Sunday of November 02:00 local).
/// packages/shared/src/sessions.ts implements the identical algorithm; spec/vectors/sessions.json
/// is checked by both test suites. Change both or neither.
library SessionLib {
    uint256 internal constant DAY = 86_400;
    uint256 internal constant EST_OFFSET = 5 hours;
    uint256 internal constant EDT_OFFSET = 4 hours;

    // Session boundaries in minutes after local midnight.
    uint256 internal constant PRE_OPEN = 240; // 04:00
    uint256 internal constant OPEN = 570; // 09:30
    uint256 internal constant CLOSE = 960; // 16:00
    uint256 internal constant EARLY_CLOSE = 780; // 13:00
    uint256 internal constant POST_CLOSE = 1200; // 20:00

    /// @dev Days since 1970-01-01 for a civil date (Howard Hinnant's algorithm, years >= 1970).
    function daysFromCivil(uint256 y, uint256 m, uint256 d) internal pure returns (uint256) {
        if (m <= 2) y -= 1;
        uint256 era = y / 400;
        uint256 yoe = y - era * 400;
        uint256 mp = m > 2 ? m - 3 : m + 9;
        uint256 doy = (153 * mp + 2) / 5 + d - 1;
        uint256 doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        return era * 146_097 + doe - 719_468;
    }

    /// @dev Civil year for a day count since 1970-01-01.
    function yearOfDay(uint256 z) internal pure returns (uint256) {
        z += 719_468;
        uint256 era = z / 146_097;
        uint256 doe = z - era * 146_097;
        uint256 yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
        uint256 y = yoe + era * 400;
        uint256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        uint256 mp = (5 * doy + 2) / 153;
        uint256 m = mp < 10 ? mp + 3 : mp - 9;
        return m <= 2 ? y + 1 : y;
    }

    /// @dev 0 = Sunday ... 6 = Saturday. 1970-01-01 was a Thursday.
    function weekday(uint256 day) internal pure returns (uint256) {
        return (day + 4) % 7;
    }

    function _nthSunday(uint256 y, uint256 m, uint256 n) private pure returns (uint256) {
        uint256 first = daysFromCivil(y, m, 1);
        uint256 toSunday = (7 - weekday(first)) % 7;
        return first + toSunday + (n - 1) * 7;
    }

    /// @dev True when New York is on daylight time at UTC timestamp `ts`.
    function isDst(uint256 ts) internal pure returns (bool) {
        uint256 y = yearOfDay(ts / DAY);
        uint256 start = _nthSunday(y, 3, 2) * DAY + 7 hours; // 02:00 EST = 07:00 UTC
        uint256 end = _nthSunday(y, 11, 1) * DAY + 6 hours; // 02:00 EDT = 06:00 UTC
        return ts >= start && ts < end;
    }

    /// @return day local day index (days since 1970-01-01 in New York time)
    /// @return minute minutes after local midnight
    function toNewYork(uint256 ts) internal pure returns (uint256 day, uint256 minute) {
        uint256 local = ts - (isDst(ts) ? EDT_OFFSET : EST_OFFSET);
        day = local / DAY;
        minute = (local % DAY) / 60;
    }
}
