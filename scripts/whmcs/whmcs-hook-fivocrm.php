<?php
/**
 * FivoCRM ⇆ WHMCS — Real-time sync hook
 * ---------------------------------------------------------------------------
 * INSTALIM:
 *   1. Kopjo këtë skedar te: <WHMCS>/includes/hooks/fivocrm_sync.php
 *   2. Vendos dy konstantet më poshtë:
 *        - FIVOCRM_WEBHOOK_URL    → https://fivocrm.vercel.app/api/whmcs-webhook
 *        - FIVOCRM_WEBHOOK_SECRET → i njëjti sekret si WHMCS_WEBHOOK_SECRET në Vercel
 *   3. Gati. WHMCS do të dërgojë çdo ngjarje fature/shërbimi te FivoCRM.
 *
 * SI FUNKSIONON:
 *   Për çdo ngjarje, dërgojmë një POST JSON të vogël { event, invoiceId, serviceId, clientId }
 *   të firmosur me HMAC-SHA256 (header `X-WHMCS-Signature`). FivoCRM e rimerr
 *   të dhënën e plotë nga WHMCS API — pra WHMCS mbetet burimi i të vërtetës.
 *
 *   Dërgimi bëhet asinkron (curl me timeout të shkurtër) që të mos ngadalësojë WHMCS.
 * ---------------------------------------------------------------------------
 */

if (!defined('WHMCS')) {
    die('Access denied');
}

if (!defined('FIVOCRM_WEBHOOK_URL')) {
    define('FIVOCRM_WEBHOOK_URL', 'https://fivocrm.vercel.app/api/whmcs-webhook');
}
if (!defined('FIVOCRM_WEBHOOK_SECRET')) {
    define('FIVOCRM_WEBHOOK_SECRET', 'VENDOS_SEKRETIN_KETU');
}

/**
 * Dërgo një ngjarje te FivoCRM (POST JSON + firmë HMAC).
 */
function fivocrm_send_event($event, array $data)
{
    if (FIVOCRM_WEBHOOK_SECRET === 'VENDOS_SEKRETIN_KETU' || empty(FIVOCRM_WEBHOOK_URL)) {
        return; // jo i konfiguruar — mos bëj asgjë
    }

    $payload = array_merge(array('event' => $event), $data);
    $body = json_encode($payload);
    $signature = hash_hmac('sha256', $body, FIVOCRM_WEBHOOK_SECRET);

    $ch = curl_init(FIVOCRM_WEBHOOK_URL);
    curl_setopt_array($ch, array(
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $body,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 8,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_HTTPHEADER     => array(
            'Content-Type: application/json',
            'X-WHMCS-Signature: ' . $signature,
        ),
    ));
    curl_exec($ch);
    if (curl_errno($ch)) {
        logActivity('FivoCRM sync error (' . $event . '): ' . curl_error($ch));
    }
    curl_close($ch);
}

// ── Ngjarjet e faturave ──────────────────────────────────────────────────────
$invoiceHooks = array(
    'InvoiceCreated',
    'InvoiceCreation',
    'AfterInvoiceModified',
    'InvoicePaid',
    'InvoiceUnpaid',
    'InvoiceCancelled',
    'InvoiceRefunded',
    'UpdateInvoiceTotal',
    'AddInvoicePayment',
);
foreach ($invoiceHooks as $hookName) {
    add_hook($hookName, 1, function ($vars) use ($hookName) {
        $invoiceId = isset($vars['invoiceid']) ? $vars['invoiceid'] : (isset($vars['invoiceId']) ? $vars['invoiceId'] : null);
        if (!$invoiceId) {
            return;
        }
        fivocrm_send_event($hookName, array(
            'invoiceId' => $invoiceId,
            'clientId'  => isset($vars['userid']) ? $vars['userid'] : null,
        ));
    });
}

// ── Ngjarjet e shërbimeve / produkteve ───────────────────────────────────────
$serviceHooks = array(
    'AfterModuleCreate',
    'AcceptOrder',
    'AfterModuleSuspend',
    'AfterModuleUnsuspend',
    'AfterModuleTerminate',
    'ServiceEdit',
);
foreach ($serviceHooks as $hookName) {
    add_hook($hookName, 1, function ($vars) use ($hookName) {
        $serviceId = isset($vars['serviceid']) ? $vars['serviceid']
            : (isset($vars['params']['serviceid']) ? $vars['params']['serviceid'] : null);
        if (!$serviceId) {
            return;
        }
        fivocrm_send_event($hookName, array(
            'serviceId' => $serviceId,
            'clientId'  => isset($vars['userid']) ? $vars['userid'] : null,
        ));
    });
}
