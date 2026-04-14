param(
    [Parameter(Mandatory = $true)]
    [string]$SubscriptionId,

    [Parameter(Mandatory = $true)]
    [string]$TenantId,

    [Parameter(Mandatory = $true)]
    [string]$ResourceGroup,

    [Parameter(Mandatory = $false)]
    [string]$RailwayService = "cloud-cost-env-api",

    [Parameter(Mandatory = $false)]
    [string]$RailwayEnvironment = "production",

    [Parameter(Mandatory = $false)]
    [string]$ServicePrincipalName = "cloud-cost-env-railway-sp",

    [Parameter(Mandatory = $false)]
    [string]$BackendBaseUrl = "https://cloud-cost-env-api-production.up.railway.app",

    [Parameter(Mandatory = $false)]
    [int]$MaxResources = 80,

    [Parameter(Mandatory = $false)]
    [int]$CredentialYears = 1
)

$ErrorActionPreference = "Stop"

function Assert-Command {
    param([string]$Name)

    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $cmd) {
        throw "Required command '$Name' was not found in PATH."
    }
}

function Main {
    Assert-Command "az"
    Assert-Command "railway"

    Write-Host "Checking Azure CLI login context..."
    $account = az account show --output json | ConvertFrom-Json
    if (-not $account -or -not $account.id) {
        throw "Azure CLI is not logged in. Run: az login"
    }

    Write-Host "Switching Azure CLI subscription..."
    az account set --subscription $SubscriptionId | Out-Null

    $scope = "/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroup"
    $spName = "$ServicePrincipalName-$(Get-Date -Format 'yyyyMMddHHmmss')"

    Write-Host "Creating least-privilege service principal at scope $scope ..."
    $spJson = az ad sp create-for-rbac `
        --name $spName `
        --role Reader `
        --scopes $scope `
        --years $CredentialYears `
        --query "{appId:appId,password:password,tenant:tenant}" `
        --output json

    $sp = $spJson | ConvertFrom-Json
    if (-not $sp.appId -or -not $sp.password -or -not $sp.tenant) {
        throw "Failed to parse service principal credentials from Azure CLI output."
    }

    Write-Host "Checking Railway CLI login context..."
    railway whoami | Out-Null

    Write-Host "Setting Railway environment variables on service '$RailwayService' ($RailwayEnvironment)..."
    railway variable set "AZURE_CLIENT_ID=$($sp.appId)" -s $RailwayService -e $RailwayEnvironment | Out-Null
    railway variable set "AZURE_TENANT_ID=$TenantId" -s $RailwayService -e $RailwayEnvironment | Out-Null
    railway variable set "AZURE_SUBSCRIPTION_ID=$SubscriptionId" -s $RailwayService -e $RailwayEnvironment | Out-Null
    $sp.password | railway variable set AZURE_CLIENT_SECRET --stdin -s $RailwayService -e $RailwayEnvironment | Out-Null

    Write-Host "Running live Azure connect verification against backend..."
    $approval = Invoke-RestMethod -Method Get -Uri ($BackendBaseUrl + "/azure/approval")
    $body = [ordered]@{
        approved = $true
        approval_token = $approval.token
        subscription_id = $SubscriptionId
        resource_group = $ResourceGroup
        tenant_id = $TenantId
        max_resources = $MaxResources
    } | ConvertTo-Json -Compress

    $connect = Invoke-RestMethod -Method Post -Uri ($BackendBaseUrl + "/azure/connect") -ContentType "application/json" -Body $body
    $dashboard = Invoke-RestMethod -Method Get -Uri ($BackendBaseUrl + "/azure/dashboard")

    $result = [PSCustomObject]@{
        servicePrincipalName = $spName
        clientId = $sp.appId
        railwayService = $RailwayService
        railwayEnvironment = $RailwayEnvironment
        connectSucceeded = [bool]$connect.connected
        sampledResources = $connect.sampled_resources
        dashboardConnected = [bool]$dashboard.connected
        dashboardResourceGroup = $dashboard.resource_group
        dashboardSubscriptionId = $dashboard.subscription_id
        updatedAt = $dashboard.updated_at
    }

    $result | ConvertTo-Json -Depth 6
}

Main
