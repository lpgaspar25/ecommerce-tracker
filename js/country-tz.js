/* Country code (ISO-2) → IANA timezone of the capital / most populous metro.
   Multi-timezone countries (US, RU, BR, CA, AU, ID, MX, CN) use their political capital.
   Returned TZs work with Date.prototype.toLocaleString({ timeZone }). */

const COUNTRY_TZ = {
    AD: 'Europe/Andorra', AE: 'Asia/Dubai', AF: 'Asia/Kabul', AG: 'America/Antigua',
    AI: 'America/Anguilla', AL: 'Europe/Tirane', AM: 'Asia/Yerevan', AO: 'Africa/Luanda',
    AQ: 'Antarctica/McMurdo', AR: 'America/Argentina/Buenos_Aires', AS: 'Pacific/Pago_Pago',
    AT: 'Europe/Vienna', AU: 'Australia/Sydney', AW: 'America/Aruba', AX: 'Europe/Mariehamn',
    AZ: 'Asia/Baku', BA: 'Europe/Sarajevo', BB: 'America/Barbados', BD: 'Asia/Dhaka',
    BE: 'Europe/Brussels', BF: 'Africa/Ouagadougou', BG: 'Europe/Sofia', BH: 'Asia/Bahrain',
    BI: 'Africa/Bujumbura', BJ: 'Africa/Porto-Novo', BL: 'America/St_Barthelemy',
    BM: 'Atlantic/Bermuda', BN: 'Asia/Brunei', BO: 'America/La_Paz', BQ: 'America/Kralendijk',
    BR: 'America/Sao_Paulo', BS: 'America/Nassau', BT: 'Asia/Thimphu', BW: 'Africa/Gaborone',
    BY: 'Europe/Minsk', BZ: 'America/Belize',
    CA: 'America/Toronto', CC: 'Indian/Cocos', CD: 'Africa/Kinshasa', CF: 'Africa/Bangui',
    CG: 'Africa/Brazzaville', CH: 'Europe/Zurich', CI: 'Africa/Abidjan', CK: 'Pacific/Rarotonga',
    CL: 'America/Santiago', CM: 'Africa/Douala', CN: 'Asia/Shanghai', CO: 'America/Bogota',
    CR: 'America/Costa_Rica', CU: 'America/Havana', CV: 'Atlantic/Cape_Verde',
    CW: 'America/Curacao', CX: 'Indian/Christmas', CY: 'Asia/Nicosia', CZ: 'Europe/Prague',
    DE: 'Europe/Berlin', DJ: 'Africa/Djibouti', DK: 'Europe/Copenhagen', DM: 'America/Dominica',
    DO: 'America/Santo_Domingo', DZ: 'Africa/Algiers',
    EC: 'America/Guayaquil', EE: 'Europe/Tallinn', EG: 'Africa/Cairo', EH: 'Africa/El_Aaiun',
    ER: 'Africa/Asmara', ES: 'Europe/Madrid', ET: 'Africa/Addis_Ababa',
    FI: 'Europe/Helsinki', FJ: 'Pacific/Fiji', FK: 'Atlantic/Stanley', FM: 'Pacific/Pohnpei',
    FO: 'Atlantic/Faroe', FR: 'Europe/Paris',
    GA: 'Africa/Libreville', GB: 'Europe/London', GD: 'America/Grenada', GE: 'Asia/Tbilisi',
    GF: 'America/Cayenne', GG: 'Europe/Guernsey', GH: 'Africa/Accra', GI: 'Europe/Gibraltar',
    GL: 'America/Godthab', GM: 'Africa/Banjul', GN: 'Africa/Conakry', GP: 'America/Guadeloupe',
    GQ: 'Africa/Malabo', GR: 'Europe/Athens', GS: 'Atlantic/South_Georgia',
    GT: 'America/Guatemala', GU: 'Pacific/Guam', GW: 'Africa/Bissau', GY: 'America/Guyana',
    HK: 'Asia/Hong_Kong', HN: 'America/Tegucigalpa', HR: 'Europe/Zagreb', HT: 'America/Port-au-Prince',
    HU: 'Europe/Budapest',
    ID: 'Asia/Jakarta', IE: 'Europe/Dublin', IL: 'Asia/Jerusalem', IM: 'Europe/Isle_of_Man',
    IN: 'Asia/Kolkata', IO: 'Indian/Chagos', IQ: 'Asia/Baghdad', IR: 'Asia/Tehran',
    IS: 'Atlantic/Reykjavik', IT: 'Europe/Rome',
    JE: 'Europe/Jersey', JM: 'America/Jamaica', JO: 'Asia/Amman', JP: 'Asia/Tokyo',
    KE: 'Africa/Nairobi', KG: 'Asia/Bishkek', KH: 'Asia/Phnom_Penh', KI: 'Pacific/Tarawa',
    KM: 'Indian/Comoro', KN: 'America/St_Kitts', KP: 'Asia/Pyongyang', KR: 'Asia/Seoul',
    KW: 'Asia/Kuwait', KY: 'America/Cayman', KZ: 'Asia/Almaty',
    LA: 'Asia/Vientiane', LB: 'Asia/Beirut', LC: 'America/St_Lucia', LI: 'Europe/Vaduz',
    LK: 'Asia/Colombo', LR: 'Africa/Monrovia', LS: 'Africa/Maseru', LT: 'Europe/Vilnius',
    LU: 'Europe/Luxembourg', LV: 'Europe/Riga', LY: 'Africa/Tripoli',
    MA: 'Africa/Casablanca', MC: 'Europe/Monaco', MD: 'Europe/Chisinau', ME: 'Europe/Podgorica',
    MF: 'America/Marigot', MG: 'Indian/Antananarivo', MH: 'Pacific/Majuro', MK: 'Europe/Skopje',
    ML: 'Africa/Bamako', MM: 'Asia/Yangon', MN: 'Asia/Ulaanbaatar', MO: 'Asia/Macau',
    MP: 'Pacific/Saipan', MQ: 'America/Martinique', MR: 'Africa/Nouakchott',
    MS: 'America/Montserrat', MT: 'Europe/Malta', MU: 'Indian/Mauritius', MV: 'Indian/Maldives',
    MW: 'Africa/Blantyre', MX: 'America/Mexico_City', MY: 'Asia/Kuala_Lumpur',
    MZ: 'Africa/Maputo',
    NA: 'Africa/Windhoek', NC: 'Pacific/Noumea', NE: 'Africa/Niamey', NF: 'Pacific/Norfolk',
    NG: 'Africa/Lagos', NI: 'America/Managua', NL: 'Europe/Amsterdam', NO: 'Europe/Oslo',
    NP: 'Asia/Kathmandu', NR: 'Pacific/Nauru', NU: 'Pacific/Niue', NZ: 'Pacific/Auckland',
    OM: 'Asia/Muscat',
    PA: 'America/Panama', PE: 'America/Lima', PF: 'Pacific/Tahiti', PG: 'Pacific/Port_Moresby',
    PH: 'Asia/Manila', PK: 'Asia/Karachi', PL: 'Europe/Warsaw', PM: 'America/Miquelon',
    PN: 'Pacific/Pitcairn', PR: 'America/Puerto_Rico', PS: 'Asia/Gaza', PT: 'Europe/Lisbon',
    PW: 'Pacific/Palau', PY: 'America/Asuncion',
    QA: 'Asia/Qatar',
    RE: 'Indian/Reunion', RO: 'Europe/Bucharest', RS: 'Europe/Belgrade', RU: 'Europe/Moscow',
    RW: 'Africa/Kigali',
    SA: 'Asia/Riyadh', SB: 'Pacific/Guadalcanal', SC: 'Indian/Mahe', SD: 'Africa/Khartoum',
    SE: 'Europe/Stockholm', SG: 'Asia/Singapore', SH: 'Atlantic/St_Helena', SI: 'Europe/Ljubljana',
    SJ: 'Arctic/Longyearbyen', SK: 'Europe/Bratislava', SL: 'Africa/Freetown', SM: 'Europe/San_Marino',
    SN: 'Africa/Dakar', SO: 'Africa/Mogadishu', SR: 'America/Paramaribo', SS: 'Africa/Juba',
    ST: 'Africa/Sao_Tome', SV: 'America/El_Salvador', SX: 'America/Lower_Princes',
    SY: 'Asia/Damascus', SZ: 'Africa/Mbabane',
    TC: 'America/Grand_Turk', TD: 'Africa/Ndjamena', TF: 'Indian/Kerguelen', TG: 'Africa/Lome',
    TH: 'Asia/Bangkok', TJ: 'Asia/Dushanbe', TK: 'Pacific/Fakaofo', TL: 'Asia/Dili',
    TM: 'Asia/Ashgabat', TN: 'Africa/Tunis', TO: 'Pacific/Tongatapu', TR: 'Europe/Istanbul',
    TT: 'America/Port_of_Spain', TV: 'Pacific/Funafuti', TW: 'Asia/Taipei', TZ: 'Africa/Dar_es_Salaam',
    UA: 'Europe/Kyiv', UG: 'Africa/Kampala', US: 'America/New_York', UY: 'America/Montevideo',
    UZ: 'Asia/Tashkent',
    VA: 'Europe/Vatican', VC: 'America/St_Vincent', VE: 'America/Caracas', VG: 'America/Tortola',
    VI: 'America/St_Thomas', VN: 'Asia/Ho_Chi_Minh', VU: 'Pacific/Efate',
    WF: 'Pacific/Wallis', WS: 'Pacific/Apia',
    YE: 'Asia/Aden', YT: 'Indian/Mayotte',
    ZA: 'Africa/Johannesburg', ZM: 'Africa/Lusaka', ZW: 'Africa/Harare',
};

// Coarser US/CA/RU/AU/BR mappings by province/state code → IANA TZ.
// Fallback used only when a provinceCode is present and the country is multi-TZ.
const PROVINCE_TZ = {
    'US-HI': 'Pacific/Honolulu',
    'US-AK': 'America/Anchorage',
    'US-WA': 'America/Los_Angeles', 'US-OR': 'America/Los_Angeles', 'US-CA': 'America/Los_Angeles',
    'US-NV': 'America/Los_Angeles',
    'US-AZ': 'America/Phoenix', 'US-UT': 'America/Denver', 'US-CO': 'America/Denver',
    'US-NM': 'America/Denver', 'US-WY': 'America/Denver', 'US-MT': 'America/Denver', 'US-ID': 'America/Boise',
    'US-TX': 'America/Chicago', 'US-OK': 'America/Chicago', 'US-KS': 'America/Chicago',
    'US-NE': 'America/Chicago', 'US-SD': 'America/Chicago', 'US-ND': 'America/Chicago',
    'US-MN': 'America/Chicago', 'US-IA': 'America/Chicago', 'US-MO': 'America/Chicago',
    'US-AR': 'America/Chicago', 'US-LA': 'America/Chicago', 'US-WI': 'America/Chicago',
    'US-IL': 'America/Chicago', 'US-MS': 'America/Chicago', 'US-AL': 'America/Chicago',
    'US-TN': 'America/Chicago', 'US-KY': 'America/Chicago',
    'CA-BC': 'America/Vancouver', 'CA-AB': 'America/Edmonton', 'CA-SK': 'America/Regina',
    'CA-MB': 'America/Winnipeg', 'CA-ON': 'America/Toronto', 'CA-QC': 'America/Toronto',
    'CA-NB': 'America/Halifax', 'CA-NS': 'America/Halifax', 'CA-PE': 'America/Halifax',
    'CA-NL': 'America/St_Johns', 'CA-YT': 'America/Whitehorse', 'CA-NT': 'America/Yellowknife',
    'CA-NU': 'America/Iqaluit',
    'AU-WA': 'Australia/Perth', 'AU-NT': 'Australia/Darwin', 'AU-SA': 'Australia/Adelaide',
    'AU-QLD': 'Australia/Brisbane', 'AU-NSW': 'Australia/Sydney', 'AU-VIC': 'Australia/Melbourne',
    'AU-TAS': 'Australia/Hobart', 'AU-ACT': 'Australia/Sydney',
    'BR-AC': 'America/Rio_Branco', 'BR-AM': 'America/Manaus', 'BR-RO': 'America/Porto_Velho',
    'BR-RR': 'America/Boa_Vista', 'BR-MT': 'America/Cuiaba', 'BR-MS': 'America/Campo_Grande',
    'BR-PA': 'America/Belem', 'BR-FN': 'America/Noronha',
    // RU: too many regions — country-level Moscow used as fallback
};

function tzForOrder(addr) {
    if (!addr) return null;
    const cc = (addr.country_code || '').toUpperCase();
    const pc = (addr.province_code || '').toUpperCase();
    if (cc && pc) {
        const key = `${cc}-${pc}`;
        if (PROVINCE_TZ[key]) return PROVINCE_TZ[key];
    }
    if (cc && COUNTRY_TZ[cc]) return COUNTRY_TZ[cc];
    return null;
}

window.CountryTZ = { COUNTRY_TZ, PROVINCE_TZ, tzForOrder };
